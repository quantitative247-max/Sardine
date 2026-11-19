// Thin wrapper over the Rust commands and the pdf:// protocol.
import { invoke } from '@tauri-apps/api/core';

const isWin = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);
// Tauri serves custom protocols as http://<scheme>.localhost on Windows, <scheme>://localhost elsewhere.
const BASE = isWin ? 'http://pdf.localhost' : 'pdf://localhost';

export const pageUrl = (id, index, width, retry = 0) => `${BASE}/page/${id}/${index}?w=${width}${retry ? `&r=${retry}` : ''}`;
export const mediaUrl = (name) => `${BASE}/media/${name}`;
export const coverUrl = (id) => `${BASE}/cover/${id}`;

export const api = {
  storeGet: (key) => invoke('store_get', { key }),
  storeSet: (key, value) => invoke('store_set', { key, value }),
  storeRemove: (key) => invoke('store_remove', { key }),
  storePrefix: (prefix) => invoke('store_prefix', { prefix }),
  importPdfs: (paths) => invoke('import_pdfs', { paths }),
  booksPresent: () => invoke('books_present'),
  removeBook: (id) => invoke('remove_book', { id }),
  info: (id) => invoke('pdf_info', { id }),
  text: (id, page) => invoke('pdf_text', { id, page }),
  snip: (id, page, rect, width) => invoke('pdf_snip', { id, page, rect, width }),
  cover: (id) => invoke('pdf_cover', { id }),
  readTextFile: (path) => invoke('read_text_file', { path }),
  saveTextFile: (path, contents) => invoke('save_text_file', { path, contents }),
  dataDir: () => invoke('data_dir'),
  revlogAppend: (lines) => invoke('revlog_append', { lines }),
  revlogRead: () => invoke('revlog_read'),
  saveMedia: (data, ext) => invoke('save_media', { data, ext }),
  importMedia: (path) => invoke('import_media', { path }),
  mediaDataUrl: (name) => invoke('media_data_url', { name }),
  startupFiles: () => invoke('startup_files'),
};
