use std::path::Path;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct StartupPath(Mutex<Option<String>>);

#[derive(Serialize)]
struct DirEntryInfo {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct ReadFileResult {
    ok: bool,
    text: String,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadImageResult {
    ok: bool,
    data_url: String,
}

#[derive(Serialize)]
struct ListDirectoryResult {
    ok: bool,
    files: Vec<DirEntryInfo>,
    dirs: Vec<DirEntryInfo>,
    error: String,
}

fn is_markdown_path(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(
        ext.as_str(),
        "md" | "markdown" | "mdown" | "mkd" | "txt" | "text"
    )
}

#[tauri::command]
fn read_file(path: String) -> ReadFileResult {
    match std::fs::read(&path) {
        Ok(bytes) => ReadFileResult {
            ok: true,
            text: String::from_utf8_lossy(&bytes).to_string(),
            error: String::new(),
        },
        Err(e) => ReadFileResult {
            ok: false,
            text: String::new(),
            error: e.to_string(),
        },
    }
}

#[tauri::command]
fn read_image(path: String) -> ReadImageResult {
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "",
    };
    if mime.is_empty() {
        return ReadImageResult {
            ok: false,
            data_url: String::new(),
        };
    }
    match std::fs::read(&path) {
        Ok(bytes) => ReadImageResult {
            ok: true,
            data_url: format!("data:{};base64,{}", mime, STANDARD.encode(bytes)),
        },
        Err(_) => ReadImageResult {
            ok: false,
            data_url: String::new(),
        },
    }
}

#[tauri::command]
fn list_directory(path: String) -> ListDirectoryResult {
    match std::fs::read_dir(&path) {
        Ok(entries) => {
            let mut files = Vec::new();
            let mut dirs = Vec::new();
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                let path_string = entry_path.to_string_lossy().to_string();
                if entry_path.is_file() {
                    files.push(DirEntryInfo {
                        name,
                        path: path_string,
                    });
                } else if entry_path.is_dir() {
                    dirs.push(DirEntryInfo {
                        name,
                        path: path_string,
                    });
                }
            }
            files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            ListDirectoryResult {
                ok: true,
                files,
                dirs,
                error: String::new(),
            }
        }
        Err(e) => ListDirectoryResult {
            ok: false,
            files: Vec::new(),
            dirs: Vec::new(),
            error: e.to_string(),
        },
    }
}

#[tauri::command]
fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
fn pick_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Markdown 文件", &["md", "markdown", "mdown", "mkd", "txt"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_directory(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn take_startup_path(state: State<'_, StartupPath>) -> Option<String> {
    state.0.lock().ok().and_then(|mut guard| guard.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_path = std::env::args().skip(1).find(|arg| is_markdown_path(arg));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = args
                .iter()
                .skip(1)
                .find(|arg| is_markdown_path(arg.as_str()))
            {
                let _ = app.emit("mdv-open-file", path.to_string());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(StartupPath(Mutex::new(startup_path)))
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_image,
            list_directory,
            is_directory,
            pick_file,
            pick_directory,
            open_url,
            take_startup_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            let path = path.to_string_lossy().to_string();
                            if let Some(state) = app.try_state::<StartupPath>() {
                                if let Ok(mut guard) = state.0.lock() {
                                    *guard = Some(path.clone());
                                }
                            }
                            let _ = app.emit("mdv-open-file", path);
                        }
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
}