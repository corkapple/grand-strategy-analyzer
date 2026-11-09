//! Secrets live in the OS keychain (macOS Keychain / Windows Credential Manager),
//! never in WebView storage.

use std::fs::File;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::AtomicU64;
#[cfg(target_os = "macos")]
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, State};

const SERVICE: &str = "app.grandstrategy.analyzer";
const BRIDGE_PORT: u16 = 47821;

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

fn set(account: &str, value: &str) -> Result<(), String> {
    let e = entry(account)?;
    if value.is_empty() {
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        };
    }
    e.set_password(value).map_err(|err| err.to_string())
}

fn get(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

/// Stores `value` under `account`; an empty value deletes the entry.
#[tauri::command]
fn secret_set(account: String, value: String) -> Result<(), String> {
    set(&account, &value)
}

#[tauri::command]
fn secret_get(account: String) -> Result<Option<String>, String> {
    get(&account)
}

// ---------------------------------------------------------------------------
// Browser bridge (Node + Playwright) started on demand by the frontend.
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Bridge(Mutex<Option<Child>>);

fn port_open() -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], BRIDGE_PORT)),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// The bundled Node sidecar sits next to the app executable; fall back to PATH.
fn find_node() -> PathBuf {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(name);
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from("node")
}

fn find_script(resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(r) = resource_dir {
        candidates.push(r.join("bridge").join("server.mjs"));
    }
    // Dev runs: the staged copy next to Cargo.toml.
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("bridge")
            .join("server.mjs"),
    );
    candidates.into_iter().find(|p| p.exists())
}

fn spawn_bridge(node: &Path, script: &Path, data_dir: &Path) -> std::io::Result<Child> {
    let profile = data_dir.join("browser-profile");
    std::fs::create_dir_all(&profile)?;
    let log = File::create(data_dir.join("bridge.log"))?;
    let mut cmd = Command::new(node);
    cmd.arg(script)
        .env("GSA_PROFILE_DIR", &profile)
        // The bridge exits by itself if this process dies without cleaning up.
        .env("GSA_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
}

fn start_bridge(app: &AppHandle, state: &Bridge) -> Result<(), String> {
    if port_open() {
        return Ok(());
    }
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(()); // still starting up
        }
    }
    let script = find_script(app.path().resource_dir().ok())
        .ok_or("Bridge files not found in the app bundle")?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let child = spawn_bridge(&find_node(), &script, &data_dir)
        .map_err(|e| format!("Could not start the bridge: {e}"))?;
    *guard = Some(child);
    Ok(())
}

// ---------------------------------------------------------------------------
// On-device text reading: macOS Vision (bundled helper) or Windows' built-in OCR.
// The image never leaves the computer. The frontend falls back to a WASM reader if this fails.
// ---------------------------------------------------------------------------

static OCR_SEQ: AtomicU64 = AtomicU64::new(0);

/// A bundled helper binary sits next to the app executable.
#[cfg(target_os = "macos")]
fn find_sidecar(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let p = dir.join(name);
    if p.exists() {
        return Some(p);
    }
    // `tauri dev`: the staged copy, named with the target triple.
    let bins = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    std::fs::read_dir(bins)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(name)))
}

#[cfg(target_os = "macos")]
fn native_ocr(bytes: &[u8], scale: f64) -> Result<String, String> {
    let exe = find_sidecar("gsa-ocr").ok_or("the on-device reader is not in this build")?;
    let tmp = std::env::temp_dir().join(format!(
        "gsa-ocr-{}-{}.img",
        std::process::id(),
        OCR_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    let out = Command::new(exe).arg(&tmp).arg(scale.to_string()).output();
    let _ = std::fs::remove_file(&tmp);
    let out = out.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(windows)]
fn native_ocr(bytes: &[u8], scale: f64) -> Result<String, String> {
    let _ = &OCR_SEQ;
    win_ocr::recognize(bytes, scale).map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn native_ocr(_bytes: &[u8], _scale: f64) -> Result<String, String> {
    let _ = &OCR_SEQ;
    Err("no on-device reader on this system".into())
}

#[cfg(windows)]
mod win_ocr {
    use windows::core::Result;
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat, BitmapTransform,
        ColorManagementMode, ExifOrientationMode,
    };
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    /// Reads the text of an image with Windows' own OCR, one line of text per row, cells joined by " | ".
    pub fn recognize(bytes: &[u8], scale: f64) -> Result<String> {
        unsafe {
            // Threads that Tauri hands us are not initialised for WinRT yet; failure here is harmless.
            let _ = windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED);
        }
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(bytes)?;
        writer.StoreAsync()?.get()?;
        writer.FlushAsync()?.get()?;
        stream.Seek(0)?;

        let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
        let max = OcrEngine::MaxImageDimension()? as f64;
        let w = decoder.PixelWidth()? as f64;
        let h = decoder.PixelHeight()? as f64;
        let factor = scale.min(max / w.max(h)).max(0.1);
        let transform = BitmapTransform::new()?;
        transform.SetScaledWidth((w * factor) as u32)?;
        transform.SetScaledHeight((h * factor) as u32)?;
        transform.SetInterpolationMode(BitmapInterpolationMode::Fant)?;
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Premultiplied,
                &transform,
                ExifOrientationMode::IgnoreExifOrientation,
                ColorManagementMode::DoNotColorManage,
            )?
            .get()?;

        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let result = engine.RecognizeAsync(&bitmap)?.get()?;

        // (vertical centre, left edge, height, text) per recognised line
        let mut lines: Vec<(f64, f64, f64, String)> = Vec::new();
        for line in result.Lines()? {
            let mut text = String::new();
            let mut rect = None;
            for word in line.Words()? {
                if rect.is_none() {
                    rect = Some(word.BoundingRect()?);
                }
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(&word.Text()?.to_string());
            }
            if let Some(r) = rect {
                lines.push(((r.Y + r.Height / 2.0) as f64, r.X as f64, r.Height as f64, text));
            }
        }
        lines.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let mut rows: Vec<Vec<(f64, String)>> = Vec::new();
        let mut last_y = f64::NEG_INFINITY;
        for (y, x, hh, text) in lines {
            if rows.is_empty() || (y - last_y).abs() > hh * 0.6 {
                rows.push(Vec::new());
            }
            rows.last_mut().unwrap().push((x, text));
            last_y = y;
        }
        let mut out = String::new();
        for mut row in rows {
            row.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
            out.push_str(&row.into_iter().map(|c| c.1).collect::<Vec<_>>().join("  |  "));
            out.push('\n');
        }
        Ok(out)
    }
}

/// Reads the text of an image on this computer. `scale` lets the caller take an independent second reading.
#[tauri::command]
async fn ocr_native(image_base64: String, scale: Option<f64>) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(image_base64.trim())
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || native_ocr(&bytes, scale.unwrap_or(1.0)))
        .await
        .map_err(|e| e.to_string())?
}

/// Opens one of a fixed list of chat sites in the user's default browser. Only these URLs are
/// accepted, so the webview can never ask the app to open (or run) anything else.
#[tauri::command]
fn open_chat(site: String) -> Result<(), String> {
    let url = match site.as_str() {
        "openrouter" => "https://openrouter.ai/workspaces/default/chat",
        "gemini" => "https://gemini.google.com/app",
        "deepseek" => "https://chat.deepseek.com/",
        "mistral" => "https://chat.mistral.ai/chat",
        "chatgpt" => "https://chatgpt.com/",
        _ => return Err("unknown chat site".into()),
    };
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler").creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Starts the bridge if it is not already listening. The frontend then polls /health.
#[tauri::command]
fn bridge_start(app: AppHandle, state: State<Bridge>) -> Result<(), String> {
    start_bridge(&app, &state)
}

/// Test hook (only active when GSA_UPDATE_TEST_ENDPOINT is set): checks that URL for an update, downloads it,
/// verifies its signature, installs it and restarts, writing progress to a log file. It lets the whole update
/// path be verified on a copy of the app without clicking through the UI.
#[cfg(desktop)]
fn update_selftest(app: &AppHandle) {
    let Ok(endpoint) = std::env::var("GSA_UPDATE_TEST_ENDPOINT") else { return };
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_updater::UpdaterExt;
        let log_path = std::env::temp_dir().join("gsa-update-test.log");
        // After the restart the same test would run again: stop once the update has been installed.
        if std::fs::read_to_string(&log_path).is_ok_and(|t| t.contains("installed")) {
            let _ = std::fs::write(&log_path, "restarted after install: ok");
            return;
        }
        let log = |m: &str| {
            let _ = std::fs::write(&log_path, m);
        };
        let updater = match endpoint
            .parse::<tauri::Url>()
            .map_err(|e| e.to_string())
            .and_then(|u| handle.updater_builder().endpoints(vec![u]).map_err(|e| e.to_string()))
            .and_then(|b| b.build().map_err(|e| e.to_string()))
        {
            Ok(u) => u,
            Err(e) => return log(&format!("setup failed: {e}")),
        };
        match updater.check().await {
            Ok(Some(update)) => {
                log(&format!("found {} (running {})", update.version, update.current_version));
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(_) => {
                        log("installed; restarting");
                        handle.restart();
                    }
                    Err(e) => log(&format!("install failed: {e}")),
                }
            }
            Ok(None) => log("no update"),
            Err(e) => log(&format!("check failed: {e}")),
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Rust-side HTTP client: bypasses WebView CORS for provider REST APIs.
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init());
    // In-app updates: signed packages from the update server, installed and restarted by the app itself.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .manage(Bridge::default())
        .invoke_handler(tauri::generate_handler![secret_set, secret_get, bridge_start, open_chat, ocr_native])
        .setup(|app| {
            // Test hook: lets the packaged app be verified without clicking through the UI.
            if std::env::var_os("GSA_BRIDGE_AUTOSTART").is_some() {
                let state = app.state::<Bridge>();
                if let Err(e) = start_bridge(app.handle(), &state) {
                    eprintln!("bridge autostart failed: {e}");
                }
            }
            #[cfg(desktop)]
            update_selftest(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Grand Strategy Analyzer")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Ok(mut g) = app.state::<Bridge>().0.lock() {
                    if let Some(mut child) = g.take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Touches the real keychain with a throwaway account and removes it again.
    #[test]
    fn keychain_roundtrip() {
        let acct = "test-roundtrip-delete-me";
        set(acct, "s3cret-value").expect("set");
        assert_eq!(get(acct).expect("get"), Some("s3cret-value".into()));
        set(acct, "").expect("delete");
        assert_eq!(get(acct).expect("get after delete"), None);
    }

    /// Spawns the staged bridge with the system Node and checks it listens, then kills it.
    #[test]
    fn bridge_spawns_and_listens() {
        let Some(script) = find_script(None) else {
            eprintln!("skipped: run `npm run prepare:bundle` first");
            return;
        };
        if port_open() {
            eprintln!("skipped: something already listens on {BRIDGE_PORT}");
            return;
        }
        let dir = std::env::temp_dir().join("gsa-bridge-test");
        let mut child = spawn_bridge(Path::new("node"), &script, &dir).expect("spawn");
        let up = (0..40).any(|_| {
            std::thread::sleep(Duration::from_millis(250));
            port_open()
        });
        let _ = child.kill();
        assert!(up, "bridge did not start listening");
    }
}
