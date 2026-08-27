// Starter UI — Tauri main
//
// 架构：
//   - 单 WebView2 窗口（启动隐藏靠系统托盘）
//   - 前端通过 Tauri invoke 调下面这些 commands
//   - commands 内部走 HTTP 调 Daemon（127.00.1:7811, Bearer token）
//
// Daemon 地址 + token 从 %ProgramData%\Starter\auth.token 读
//（如果 Daemon 未运行，UI 提示用户启动）

// 以 Windows GUI 子系统运行（不弹控制台窗口）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};

const DEFAULT_PORT: u16 = 7811;
const DEFAULT_HOST: &str = "127.0.0.1";

#[derive(Clone)]
struct DaemonConfig {
    base_url: String,
    token: String,
}

static DAEMON: OnceLock<DaemonConfig> = OnceLock::new();

fn data_dir() -> PathBuf {
    if let Ok(pd) = std::env::var("ProgramData") {
        return PathBuf::from(pd).join("Starter");
    }
    PathBuf::from(".").join(".starter")
}

fn load_daemon_config() -> DaemonConfig {
    let port = std::env::var("STARTER_DAEMON_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    let host = std::env::var("STARTER_DAEMON_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string());
    let token_path = data_dir().join("auth.token");
    let token = fs::read_to_string(&token_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    DaemonConfig {
        base_url: format!("http://{}:{}", host, port),
        token,
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct RpcResponse {
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
}

async fn rpc(method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let cfg = DAEMON.get().ok_or_else(|| "daemon config not loaded".to_string())?;
    let url = format!("{}/rpc", cfg.base_url);
    let body = serde_json::json!({
        "method": method,
        "params": params,
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("client build: {}", e))?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", cfg.token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("send: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status()));
    }
    let parsed: RpcResponse = resp
        .json()
        .await
        .map_err(|e| format!("parse: {}", e))?;
    if !parsed.ok {
        return Err(parsed.error.unwrap_or_else(|| "unknown error".into()));
    }
    Ok(parsed.result.unwrap_or(serde_json::json!(null)))
}

#[tauri::command]
async fn list_items(filter: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    rpc("list", filter.unwrap_or(serde_json::json!({}))).await
}

#[tauri::command]
async fn show_item(id: String) -> Result<serde_json::Value, String> {
    rpc("show", serde_json::json!({ "id": id })).await
}

#[tauri::command]
async fn enable_item(id: String) -> Result<serde_json::Value, String> {
    rpc("enable", serde_json::json!({ "id": id })).await
}

#[tauri::command]
async fn disable_item(id: String) -> Result<serde_json::Value, String> {
    rpc("disable", serde_json::json!({ "id": id })).await
}

#[tauri::command]
async fn set_delay(id: String, delay_ms: u64) -> Result<serde_json::Value, String> {
    rpc("set_delay", serde_json::json!({ "id": id, "delay_ms": delay_ms })).await
}

#[tauri::command]
async fn set_priority(id: String, priority: i32) -> Result<serde_json::Value, String> {
    rpc("set_priority", serde_json::json!({ "id": id, "priority": priority })).await
}

#[tauri::command]
async fn scan_items() -> Result<serde_json::Value, String> {
    rpc("scan", serde_json::json!({})).await
}

#[tauri::command]
async fn doctor() -> Result<serde_json::Value, String> {
    rpc("doctor", serde_json::json!({})).await
}

#[tauri::command]
async fn schedule_run(simulated_ms: Option<u64>) -> Result<serde_json::Value, String> {
    rpc(
        "schedule_run",
        serde_json::json!({ "simulated_ms": simulated_ms.unwrap_or(0) }),
    )
    .await
}

#[tauri::command]
async fn timeline(limit: Option<u64>) -> Result<serde_json::Value, String> {
    rpc("timeline", serde_json::json!({ "limit": limit.unwrap_or(50) })).await
}

#[tauri::command]
async fn io_status() -> Result<serde_json::Value, String> {
    rpc("io_status", serde_json::json!({})).await
}

#[tauri::command]
async fn service_status() -> Result<serde_json::Value, String> {
    rpc("service_status", serde_json::json!({})).await
}

#[tauri::command]
fn daemon_status() -> serde_json::Value {
    let cfg = DAEMON.get().cloned().unwrap_or(DaemonConfig {
        base_url: format!("http://{}:{}", DEFAULT_HOST, DEFAULT_PORT),
        token: String::new(),
    });
    serde_json::json!({
        "base_url": cfg.base_url,
        "has_token": !cfg.token.is_empty(),
    })
}

#[tauri::command]
async fn add_dependency(id: String, depends_on: String) -> Result<serde_json::Value, String> {
    rpc("add_dependency", serde_json::json!({"id": id, "depends_on": depends_on})).await
}

#[tauri::command]
async fn remove_dependency(id: String, depends_on: String) -> Result<serde_json::Value, String> {
    rpc("remove_dependency", serde_json::json!({"id": id, "depends_on": depends_on})).await
}

#[tauri::command]
async fn list_dependencies(id: String) -> Result<serde_json::Value, String> {
    rpc("list_dependencies", serde_json::json!({"id": id})).await
}

#[tauri::command]
async fn apply_preset(rules: serde_json::Value) -> Result<serde_json::Value, String> {
    rpc("apply_preset", serde_json::json!({"rules": rules})).await
}

#[tauri::command]
async fn undo_last_change(limit: Option<u32>) -> Result<serde_json::Value, String> {
    let l = limit.unwrap_or(5);
    rpc("undo_last_change", serde_json::json!({"limit": l})).await
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[allow(dead_code)]
fn hide_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

fn main() {
    let _ = DAEMON.set(load_daemon_config());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            list_items,
            show_item,
            enable_item,
            disable_item,
            set_delay,
            set_priority,
            scan_items,
            doctor,
            schedule_run,
            timeline,
            io_status,
            service_status,
            daemon_status,
            add_dependency,
            remove_dependency,
            list_dependencies,
            apply_preset,
            undo_last_change,
        ])
        .setup(|app| {
            // 托盘菜单
            let open_item = MenuItem::with_id(app, "open", "Open Starter", true, None::<&str>)?;
            let scan_item = MenuItem::with_id(app, "scan", "Rescan now", true, None::<&str>)?;
            let timeline_item = MenuItem::with_id(app, "timeline", "View timeline", true, None::<&str>)?;
            let io_item = MenuItem::with_id(app, "io", "Check disk IO", true, None::<&str>)?;
            let sep = tauri::menu::PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&open_item, &scan_item, &timeline_item, &io_item, &sep, &quit_item],
            )?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Starter — startup manager")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_window(app),
                    "scan" => {
                        let _ = app.emit("tray-scan", ());
                        show_window(app);
                    }
                    "timeline" => {
                        let _ = app.emit("tray-timeline", ());
                        show_window(app);
                    }
                    "io" => {
                        let _ = app.emit("tray-io", ());
                        show_window(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // 默认显示主窗口；STARTER_UI_HIDDEN=1 时隐藏到托盘（无头模式）
            if std::env::var("STARTER_UI_HIDDEN").as_deref() == Ok("1") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            } else if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }

            // Mica 亚克力材质（Win11 22000+；跟随系统深色模式）
            if let Some(w) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                if window_vibrancy::apply_mica(&w, None).is_err() {
                    // 非 Win11 回退到 acrylic
                    let _ = window_vibrancy::apply_acrylic(&w, None);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮 = 隐藏窗口（不退出进程，托盘仍在）
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                // 阻止默认退出，保持托盘
                api.prevent_exit();
            }
        });
}
