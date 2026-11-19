mod pdf;

use pdf::{fingerprint, safe_id, DocInfo, Engine, Run};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

// ------------------------------------------------------------ storage (JSON files)

fn store_dir(e: &Engine) -> PathBuf { e.data_dir.join("store") }

fn key_file(e: &Engine, key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || key.len() > 120 || !key.chars().all(|c| c.is_ascii_alphanumeric() || "-_/.".contains(c)) || key.contains("..") {
        return Err(format!("bad key {key}"));
    }
    Ok(store_dir(e).join(format!("{}.json", key.replace('/', "~"))))
}

#[tauri::command]
fn store_get(e: State<Engine>, key: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(key_file(&e, &key)?) {
        Ok(s) => Ok(Some(s)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn store_set(e: State<Engine>, key: String, value: String) -> Result<(), String> {
    let f = key_file(&e, &key)?;
    let tmp = f.with_extension("json.tmp");
    std::fs::write(&tmp, value).map_err(|x| x.to_string())?;
    std::fs::rename(&tmp, &f).map_err(|x| x.to_string())
}

#[tauri::command]
fn store_remove(e: State<Engine>, key: String) -> Result<(), String> {
    let _ = std::fs::remove_file(key_file(&e, &key)?);
    Ok(())
}

/// All entries whose key starts with `prefix`.
#[tauri::command]
fn store_prefix(e: State<Engine>, prefix: String) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    let p = prefix.replace('/', "~");
    for ent in std::fs::read_dir(store_dir(&e)).map_err(|x| x.to_string())? {
        let ent = ent.map_err(|x| x.to_string())?;
        let name = ent.file_name().to_string_lossy().to_string();
        if let Some(stem) = name.strip_suffix(".json") {
            if stem.starts_with(&p) {
                if let Ok(s) = std::fs::read_to_string(ent.path()) { out.insert(stem.replace('~', "/"), s); }
            }
        }
    }
    Ok(out)
}

// ------------------------------------------------------------ library

#[derive(Serialize)]
struct Imported {
    id: String,
    name: String,
    title: Option<String>,
    author: Option<String>,
    num_pages: u32,
    existed: bool,
}

#[tauri::command]
async fn import_pdfs(e: State<'_, Engine>, paths: Vec<String>) -> Result<Vec<Imported>, String> {
    let mut out = Vec::new();
    for p in paths {
        let src = Path::new(&p);
        if !src.extension().map(|x| x.eq_ignore_ascii_case("pdf")).unwrap_or(false) { continue; }
        let id = fingerprint(src)?;
        let dest = e.data_dir.join("books").join(format!("{id}.pdf"));
        let existed = dest.exists();
        if !existed {
            let tmp = dest.with_extension("part");
            std::fs::copy(src, &tmp).map_err(|x| format!("copy {}: {x}", src.display()))?;
            std::fs::rename(&tmp, &dest).map_err(|x| x.to_string())?;
        }
        let id2 = id.clone();
        let meta = e
            .call(move |c| {
                let m = c.meta(&id2)?;
                if let Err(err) = c.cover(&id2) { eprintln!("cover: {err}"); }
                Ok(m)
            })
            .await;
        let meta = match meta {
            Ok(m) => m,
            Err(err) => {
                if !existed { let _ = std::fs::remove_file(&dest); }
                return Err(format!("{}: {err}", src.display()));
            }
        };
        out.push(Imported {
            id,
            name: src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
            title: meta.title,
            author: meta.author,
            num_pages: meta.num_pages,
            existed,
        });
    }
    Ok(out)
}

#[tauri::command]
fn books_present(e: State<Engine>) -> Vec<String> {
    std::fs::read_dir(e.data_dir.join("books"))
        .map(|rd| rd.filter_map(|x| x.ok()).filter_map(|x| x.file_name().to_string_lossy().strip_suffix(".pdf").map(String::from)).collect())
        .unwrap_or_default()
}

#[tauri::command]
async fn remove_book(e: State<'_, Engine>, id: String) -> Result<(), String> {
    let id = safe_id(&id).to_string();
    let id2 = id.clone();
    e.call(move |c| { c.close(&id2); Ok(()) }).await?;
    let _ = std::fs::remove_file(e.data_dir.join("books").join(format!("{id}.pdf")));
    let _ = std::fs::remove_file(e.data_dir.join("covers").join(format!("{id}.jpg")));
    Ok(())
}

// ------------------------------------------------------------ pdf

#[tauri::command]
async fn pdf_info(e: State<'_, Engine>, id: String) -> Result<DocInfo, String> {
    e.call(move |c| c.info(&id)).await
}

#[tauri::command]
async fn pdf_text(e: State<'_, Engine>, id: String, page: u16) -> Result<Vec<Run>, String> {
    e.call(move |c| c.text(&id, page)).await
}

#[tauri::command]
async fn pdf_snip(e: State<'_, Engine>, id: String, page: u16, rect: [f32; 4], width: u32) -> Result<String, String> {
    e.call(move |c| c.snip(&id, page, rect, width)).await
}

#[tauri::command]
async fn pdf_cover(e: State<'_, Engine>, id: String) -> Result<(), String> {
    e.call(move |c| c.cover(&id)).await
}

#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// PDFs passed on the command line (e.g. "Open with Margin").
#[tauri::command]
fn startup_files() -> Vec<String> {
    std::env::args().skip(1).filter(|a| a.to_lowercase().ends_with(".pdf") && Path::new(a).exists()).collect()
}

#[tauri::command]
fn data_dir(e: State<Engine>) -> String { e.data_dir.display().to_string() }

// ------------------------------------------------------------ setup

fn find_pdfium(app: &tauri::App) -> Option<PathBuf> {
    let name = pdfium_render::prelude::Pdfium::pdfium_platform_library_name();
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("PDFIUM_DIR") { dirs.push(PathBuf::from(p)); }
    if let Ok(r) = app.path().resource_dir() { dirs.push(r.join("pdfium")); dirs.push(r); }
    if let Ok(exe) = std::env::current_exe() { if let Some(d) = exe.parent() { dirs.push(d.to_path_buf()); dirs.push(d.join("pdfium")); } }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("pdfium"));
    dirs.into_iter().map(|d| d.join(&name)).find(|p| p.exists())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            for d in ["books", "covers", "store"] { std::fs::create_dir_all(data.join(d))?; }
            let lib = find_pdfium(app);
            let engine = Engine::start(lib, data).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(engine);
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("pdf", |ctx, request, responder| {
            let engine = ctx.app_handle().state::<Engine>().inner().clone();
            engine.handle_protocol(request, responder);
        })
        .invoke_handler(tauri::generate_handler![
            store_get, store_set, store_remove, store_prefix,
            import_pdfs, books_present, remove_book,
            pdf_info, pdf_text, pdf_snip, pdf_cover, save_text_file, read_text_file, data_dir, startup_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running Margin");
}
