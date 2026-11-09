//! Secrets live in the OS keychain (macOS Keychain / Windows Credential Manager),
//! never in WebView storage.

use std::fs::File;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
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

/// Starts the bridge if it is not already listening. The frontend then polls /health.
/// Opens one of a fixed list of chat sites in the user's default browser. Only these URLs are
/// accepted, so the webview can never ask the app to open (or run) anything else.
#[tauri::command]
fn open_chat(site: String) -> Result<(), String> {
    let url = match site.as_str() {
        "openrouter" => "https://openrouter.ai/workspaces/default/chat",
        "gemini" => "https://gemini.google.com/app",
        "deepseek" => "https://chat.deepseek.com/",
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

#[tauri::command]
fn bridge_start(app: AppHandle, state: State<Bridge>) -> Result<(), String> {
    start_bridge(&app, &state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Rust-side HTTP client: bypasses WebView CORS for provider REST APIs.
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Bridge::default())
        .invoke_handler(tauri::generate_handler![secret_set, secret_get, bridge_start, open_chat])
        .setup(|app| {
            // Test hook: lets the packaged app be verified without clicking through the UI.
            if std::env::var_os("GSA_BRIDGE_AUTOSTART").is_some() {
                let state = app.state::<Bridge>();
                if let Err(e) = start_bridge(app.handle(), &state) {
                    eprintln!("bridge autostart failed: {e}");
                }
            }
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
