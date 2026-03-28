#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod error;
mod logger;
mod runtime;

use config::AppConfig;
use runtime::{AppRuntime, AppStatePayload, LogBundle};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
fn get_app_state(runtime: State<'_, AppRuntime>) -> Result<AppStatePayload, String> {
    runtime.inspect_state().map_err(|e| e.to_string())
}

#[tauri::command]
fn initialize_runtime(runtime: State<'_, AppRuntime>) -> Result<AppStatePayload, String> {
    runtime.initialize_runtime().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_app_config(runtime: State<'_, AppRuntime>, config: AppConfig) -> Result<AppStatePayload, String> {
    runtime.save_config(config).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_openclaw(runtime: State<'_, AppRuntime>) -> Result<AppStatePayload, String> {
    runtime.start().map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_openclaw(runtime: State<'_, AppRuntime>) -> Result<AppStatePayload, String> {
    runtime.stop().map_err(|e| e.to_string())
}

#[tauri::command]
fn read_logs(runtime: State<'_, AppRuntime>) -> Result<LogBundle, String> {
    runtime.read_logs().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_logs_dir(runtime: State<'_, AppRuntime>) -> Result<(), String> {
    runtime.open_logs_dir().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_control_page(app: AppHandle, runtime: State<'_, AppRuntime>) -> Result<(), String> {
    runtime.open_control_page(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn check_update(runtime: State<'_, AppRuntime>) -> Result<String, String> {
    runtime.check_update().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_install_dir(runtime: State<'_, AppRuntime>) -> Result<(), String> {
    runtime.open_install_dir().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppRuntime::default())
        .setup(|app| {
            let runtime = app.state::<AppRuntime>();
            runtime.set_handle(app.handle().clone());
            let _ = runtime.initialize_runtime();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("OpenClaw Portable");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            initialize_runtime,
            save_app_config,
            start_openclaw,
            stop_openclaw,
            read_logs,
            open_logs_dir,
            open_control_page,
            check_update,
            open_install_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
