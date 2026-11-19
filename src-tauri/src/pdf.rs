//! PDF engine: a single worker thread owns Pdfium and every open document.
//!
//! Pdfium is not thread-safe, so all work is funnelled through this thread.
//! Commands (open, text, outline…) are FIFO; page renders are LIFO so the page
//! you just scrolled to is drawn first, and stale renders are dropped.

use base64::Engine as _;
use image::{codecs::jpeg::JpegEncoder, codecs::png, ImageEncoder};
use pdfium_render::prelude::*;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};

const MAX_PENDING_RENDERS: usize = 10;
const CACHE_ENTRIES: usize = 24;
const MAX_OPEN_DOCS: usize = 4;

type Job = Box<dyn FnOnce(Option<&mut Ctx>) + Send>;

struct Queues {
    urgent: VecDeque<Job>,
    renders: VecDeque<Job>,
}

#[derive(Clone)]
pub struct Engine {
    q: Arc<(Mutex<Queues>, Condvar)>,
    pub data_dir: PathBuf,
}

struct Ctx {
    pdfium: &'static Pdfium,
    docs: HashMap<String, PdfDocument<'static>>,
    order: VecDeque<String>,
    cache: VecDeque<((String, u16, u32), Arc<Vec<u8>>)>,
    data_dir: PathBuf,
}

impl Engine {
    pub fn start(lib: Option<PathBuf>, data_dir: PathBuf) -> Result<Engine, String> {
        let q = Arc::new((
            Mutex::new(Queues { urgent: VecDeque::new(), renders: VecDeque::new() }),
            Condvar::new(),
        ));
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let q2 = q.clone();
        let dd = data_dir.clone();
        std::thread::Builder::new()
            .name("pdfium".into())
            .spawn(move || {
                let bindings = match &lib {
                    Some(p) => Pdfium::bind_to_library(p),
                    None => Pdfium::bind_to_system_library(),
                };
                let bindings = match bindings {
                    Ok(b) => b,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("Could not load pdfium ({:?}): {e}", lib)));
                        return;
                    }
                };
                let pdfium: &'static Pdfium = Box::leak(Box::new(Pdfium::new(bindings)));
                let _ = ready_tx.send(Ok(()));
                let mut ctx = Ctx { pdfium, docs: HashMap::new(), order: VecDeque::new(), cache: VecDeque::new(), data_dir: dd };
                let (lock, cv) = &*q2;
                loop {
                    let job = {
                        let mut g = lock.lock().unwrap();
                        loop {
                            if let Some(j) = g.urgent.pop_front() { break j; }
                            if let Some(j) = g.renders.pop_back() { break j; }
                            g = cv.wait(g).unwrap();
                        }
                    };
                    job(Some(&mut ctx));
                }
            })
            .map_err(|e| e.to_string())?;
        ready_rx.recv().map_err(|e| e.to_string())??;
        Ok(Engine { q, data_dir })
    }

    fn push(&self, job: Job, render: bool) {
        let (lock, cv) = &*self.q;
        let dropped = {
            let mut g = lock.lock().unwrap();
            if render {
                g.renders.push_back(job);
                if g.renders.len() > MAX_PENDING_RENDERS { g.renders.pop_front() } else { None }
            } else {
                g.urgent.push_back(job);
                None
            }
        };
        if let Some(j) = dropped { j(None); }
        cv.notify_one();
    }

    /// Run `f` on the worker thread and await its result.
    pub async fn call<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut CtxHandle) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.push(
            Box::new(move |ctx| {
                let r = match ctx {
                    Some(c) => f(&mut CtxHandle(c)),
                    None => Err("cancelled".into()),
                };
                let _ = tx.send(r);
            }),
            false,
        );
        rx.await.map_err(|e| e.to_string())?
    }

    /// Handle `pdf://localhost/page/<id>/<index>?w=<px>` and `/cover/<id>`.
    pub fn handle_protocol(
        &self,
        req: tauri::http::Request<Vec<u8>>,
        responder: tauri::UriSchemeResponder,
    ) {
        let uri = req.uri();
        let path = uri.path().trim_start_matches('/').to_string();
        let query = uri.query().unwrap_or("").to_string();
        let parts: Vec<&str> = path.split('/').collect();
        let respond = move |status: u16, mime: &str, body: Vec<u8>| {
            responder.respond(
                tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Cache-Control", "max-age=31536000, immutable")
                    .body(body)
                    .unwrap(),
            )
        };
        match parts.as_slice() {
            ["cover", id] => {
                let p = self.data_dir.join("covers").join(format!("{}.jpg", safe_id(id)));
                match std::fs::read(p) {
                    Ok(b) => respond(200, "image/jpeg", b),
                    Err(_) => respond(404, "text/plain", b"no cover".to_vec()),
                }
            }
            ["media", name] => {
                let ok = !name.is_empty() && name.len() < 80 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.') && !name.starts_with('.');
                let p = self.data_dir.join("media").join(if ok { *name } else { "invalid" });
                match std::fs::read(p) {
                    Ok(b) => respond(200, crate::media_mime(name), b),
                    Err(_) => respond(404, "text/plain", b"no media".to_vec()),
                }
            }
            ["page", id, idx] => {
                let id = safe_id(id).to_string();
                let Ok(page) = idx.parse::<u16>() else { return respond(400, "text/plain", vec![]) };
                let width = query
                    .split('&')
                    .find_map(|kv| kv.strip_prefix("w="))
                    .and_then(|v| v.parse::<u32>().ok())
                    .unwrap_or(1200)
                    .clamp(64, 6000);
                self.push(
                    Box::new(move |ctx| {
                        let Some(ctx) = ctx else { return respond(503, "text/plain", b"dropped".to_vec()) };
                        match render_png(ctx, &id, page, width) {
                            Ok(bytes) => respond(200, "image/png", bytes.as_ref().clone()),
                            Err(e) => respond(500, "text/plain", e.into_bytes()),
                        }
                    }),
                    true,
                );
            }
            _ => respond(404, "text/plain", vec![]),
        }
    }
}

/// Opaque handle so commands can use the context without exposing its fields.
pub struct CtxHandle<'a>(&'a mut Ctx);

pub fn safe_id(id: &str) -> &str {
    if id.chars().all(|c| c.is_ascii_alphanumeric()) && id.len() < 64 { id } else { "invalid" }
}

fn doc<'a>(ctx: &'a mut Ctx, id: &str) -> Result<&'a PdfDocument<'static>, String> {
    if !ctx.docs.contains_key(id) {
        let path = ctx.data_dir.join("books").join(format!("{}.pdf", safe_id(id)));
        let d = ctx.pdfium.load_pdf_from_file(&path, None).map_err(|e| format!("open {}: {e}", path.display()))?;
        ctx.docs.insert(id.to_string(), d);
        ctx.order.push_back(id.to_string());
        while ctx.order.len() > MAX_OPEN_DOCS {
            if let Some(old) = ctx.order.pop_front() { ctx.docs.remove(&old); }
        }
    } else if let Some(pos) = ctx.order.iter().position(|x| x == id) {
        let k = ctx.order.remove(pos).unwrap();
        ctx.order.push_back(k);
    }
    Ok(ctx.docs.get(id).unwrap())
}

fn render_png(ctx: &mut Ctx, id: &str, page: u16, width: u32) -> Result<Arc<Vec<u8>>, String> {
    let key = (id.to_string(), page, width);
    if let Some((_, v)) = ctx.cache.iter().find(|(k, _)| *k == key) {
        return Ok(v.clone());
    }
    let d = doc(ctx, id)?;
    let p = d.pages().get(page as PdfPageIndex).map_err(|e| e.to_string())?;
    let cfg = PdfRenderConfig::new().set_target_width(width as Pixels).render_form_data(true);
    let bmp = p.render_with_config(&cfg).map_err(|e| e.to_string())?;
    let (w, h) = (bmp.width() as u32, bmp.height() as u32);
    let rgba = bmp.as_rgba_bytes();
    let mut out = Vec::with_capacity((w * h) as usize);
    png::PngEncoder::new_with_quality(&mut out, png::CompressionType::Fast, png::FilterType::Sub)
        .write_image(&rgba, w, h, image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    let out = Arc::new(out);
    ctx.cache.push_back((key, out.clone()));
    if ctx.cache.len() > CACHE_ENTRIES { ctx.cache.pop_front(); }
    Ok(out)
}

// ---------------------------------------------------------------- results

#[derive(Serialize)]
pub struct DocInfo {
    pub num_pages: u32,
    /// page sizes in points, [width, height]
    pub sizes: Vec<[f32; 2]>,
    pub outline: Vec<OutlineNode>,
}

#[derive(Serialize)]
pub struct OutlineNode {
    pub title: String,
    pub page: Option<u32>, // 1-based
    pub kids: Vec<OutlineNode>,
}

#[derive(Serialize)]
pub struct Meta {
    pub title: Option<String>,
    pub author: Option<String>,
    pub num_pages: u32,
}

/// A run of text on one line, in page-relative coordinates (0–1, top-left origin).
#[derive(Serialize)]
pub struct Run {
    pub t: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub eol: bool,
}

impl<'a> CtxHandle<'a> {
    pub fn info(&mut self, id: &str) -> Result<DocInfo, String> {
        let d = doc(self.0, id)?;
        let pages = d.pages();
        let n = pages.len() as u32;
        let mut sizes = Vec::with_capacity(n as usize);
        for i in 0..n {
            let r = pages.page_size(i as PdfPageIndex).map_err(|e| e.to_string())?;
            sizes.push([r.width().value, r.height().value]);
        }
        let mut budget = 20_000usize;
        let outline = match d.bookmarks().root() {
            Some(first) => walk_outline(Some(first), 0, &mut budget),
            None => vec![],
        };
        Ok(DocInfo { num_pages: n, sizes, outline })
    }

    pub fn meta(&mut self, id: &str) -> Result<Meta, String> {
        let d = doc(self.0, id)?;
        let m = d.metadata();
        let get = |t| m.get(t).map(|v| v.value().trim().to_string()).filter(|s| !s.is_empty());
        Ok(Meta { title: get(PdfDocumentMetadataTagType::Title), author: get(PdfDocumentMetadataTagType::Author), num_pages: d.pages().len() as u32 })
    }

    pub fn cover(&mut self, id: &str) -> Result<(), String> {
        let out = self.0.data_dir.join("covers").join(format!("{}.jpg", safe_id(id)));
        let d = doc(self.0, id)?;
        let p = d.pages().get(0).map_err(|e| e.to_string())?;
        let bmp = p.render_with_config(&PdfRenderConfig::new().set_target_width(320)).map_err(|e| e.to_string())?;
        let img = bmp.as_image().map_err(|e| e.to_string())?.to_rgb8();
        let mut buf = Vec::new();
        JpegEncoder::new_with_quality(&mut buf, 84).encode_image(&img).map_err(|e| e.to_string())?;
        std::fs::write(out, buf).map_err(|e| e.to_string())
    }

    pub fn close(&mut self, id: &str) {
        self.0.docs.remove(id);
        self.0.order.retain(|x| x != id);
        self.0.cache.retain(|(k, _)| k.0 != id);
    }

    pub fn text(&mut self, id: &str, page: u16) -> Result<Vec<Run>, String> {
        let d = doc(self.0, id)?;
        let p = d.pages().get(page as PdfPageIndex).map_err(|e| e.to_string())?;
        let box_ = p.page_size();
        let (ox, oy, pw, ph) = (box_.left().value, box_.bottom().value, box_.width().value, box_.height().value);
        let text = p.text().map_err(|e| e.to_string())?;
        let mut runs: Vec<Run> = Vec::new();
        // current run in PDF space: left, bottom, right, top
        let mut cur: Option<(String, f32, f32, f32, f32)> = None;
        let flush = |cur: &mut Option<(String, f32, f32, f32, f32)>, runs: &mut Vec<Run>, eol: bool| {
            if let Some((t, l, b, r, tp)) = cur.take() {
                if !t.trim().is_empty() {
                    runs.push(Run {
                        t,
                        x: (l - ox) / pw,
                        y: (oy + ph - tp) / ph,
                        w: (r - l).max(0.1) / pw,
                        h: (tp - b).max(0.1) / ph,
                        eol,
                    });
                }
            } else if eol {
                if let Some(last) = runs.last_mut() { last.eol = true; }
            }
        };
        for ch in text.chars().iter() {
            let s = match ch.unicode_string() { Some(s) => s, None => continue };
            if s == "\r" || s == "\n" || s == "\r\n" {
                flush(&mut cur, &mut runs, true);
                continue;
            }
            let Ok(bb) = ch.loose_bounds() else { continue };
            let (l, b, r, t) = (bb.left().value, bb.bottom().value, bb.right().value, bb.top().value);
            let h = (t - b).max(0.5);
            if s.trim().is_empty() {
                if let Some(c) = cur.as_mut() { c.0.push(' '); }
                continue;
            }
            let start_new = match &cur {
                None => true,
                Some((_, cl, cb, cr, ct)) => {
                    let ch_ = (ct - cb).max(0.5);
                    let same_line = ((b + t) / 2.0 - (cb + ct) / 2.0).abs() < 0.5 * ch_.min(h);
                    let gap = l - cr;
                    !same_line || gap > 1.6 * h || l < cl - 0.5 || gap < -0.8 * h
                }
            };
            if start_new {
                let line_break = cur.as_ref().map(|(_, _, cb, _, ct)| ((b + t) / 2.0 - (cb + ct) / 2.0).abs() > 0.5 * h).unwrap_or(false);
                flush(&mut cur, &mut runs, line_break);
                cur = Some((s, l, b, r, t));
            } else if let Some(c) = cur.as_mut() {
                c.0.push_str(&s);
                c.1 = c.1.min(l);
                c.2 = c.2.min(b);
                c.3 = c.3.max(r);
                c.4 = c.4.max(t);
            }
        }
        flush(&mut cur, &mut runs, true);
        for r in runs.iter_mut() { let t = r.t.trim_end().to_string(); r.t = t; }
        Ok(runs)
    }

    /// Render a region (normalised rect) at high resolution and return a PNG data URL.
    pub fn snip(&mut self, id: &str, page: u16, rect: [f32; 4], width: u32) -> Result<String, String> {
        let d = doc(self.0, id)?;
        let p = d.pages().get(page as PdfPageIndex).map_err(|e| e.to_string())?;
        let bmp = p.render_with_config(&PdfRenderConfig::new().set_target_width(width.clamp(200, 5000) as Pixels)).map_err(|e| e.to_string())?;
        let img = bmp.as_image().map_err(|e| e.to_string())?.to_rgba8();
        let (iw, ih) = (img.width() as f32, img.height() as f32);
        let x = (rect[0] * iw).max(0.0) as u32;
        let y = (rect[1] * ih).max(0.0) as u32;
        let w = ((rect[2] * iw) as u32).max(1).min(img.width() - x.min(img.width() - 1));
        let h = ((rect[3] * ih) as u32).max(1).min(img.height() - y.min(img.height() - 1));
        let crop = image::imageops::crop_imm(&img, x, y, w, h).to_image();
        let mut out = Vec::new();
        png::PngEncoder::new(&mut out).write_image(crop.as_raw(), w, h, image::ExtendedColorType::Rgba8).map_err(|e| e.to_string())?;
        Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out)))
    }
}

fn walk_outline(first: Option<PdfBookmark<'_>>, depth: usize, budget: &mut usize) -> Vec<OutlineNode> {
    let mut out = Vec::new();
    let mut cur = first;
    while let Some(bm) = cur {
        if *budget == 0 { break; }
        *budget -= 1;
        let page = bm
            .destination()
            .and_then(|d| d.page_index().ok())
            .or_else(|| {
                bm.action().and_then(|a| a.as_local_destination_action().and_then(|l| l.destination().ok()).and_then(|d| d.page_index().ok()))
            })
            .map(|i| i as u32 + 1);
        let kids = if depth < 8 { walk_outline(bm.first_child(), depth + 1, budget) } else { vec![] };
        let page = page.or_else(|| kids.first().and_then(|k| k.page));
        out.push(OutlineNode { title: bm.title().unwrap_or_default().trim().to_string(), page, kids });
        cur = bm.next_sibling();
    }
    out
}

/// Same fingerprint as the single-file HTML version, so backups line up.
pub fn fingerprint(path: &Path) -> Result<String, String> {
    let len = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let n = len.min(4_000_000) as usize;
    let mut buf = vec![0u8; n];
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;
    let mut h1: u32 = 0x811c9dc5;
    let mut h2: u32 = 0x01000193 ^ (n as u32);
    for &b in &buf {
        h1 = (h1 ^ b as u32).wrapping_mul(16777619);
        h2 = (h2 ^ b as u32).wrapping_mul(2246822519) ^ (h2 >> 13);
    }
    Ok(format!("d{:x}{:x}{:x}", h1, h2, len))
}
