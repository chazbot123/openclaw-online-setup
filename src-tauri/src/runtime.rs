use serde::Serialize;
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{
    config::AppConfig,
    error::{AppError, AppResult},
    logger,
};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBundle {
    pub app: String,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeStatus {
    Uninitialized,
    Ready,
    Running,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatePayload {
    pub base_dir: String,
    pub runtime_dir: String,
    pub openclaw_dir: String,
    pub workspace_dir: String,
    pub config_path: String,
    pub log_dir: String,
    pub app_version: String,
    pub status: RuntimeStatus,
    pub status_message: String,
    pub payload_detected: bool,
    pub payload_path: String,
    pub control_page_url: String,
    pub device_fingerprint: String,
    pub is_authorized: bool,
    pub config: AppConfig,
}

pub struct ManagedProcess {
    child: Child,
}

pub struct AppRuntime {
    process: Mutex<Option<ManagedProcess>>,
    app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl Default for AppRuntime {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            app_handle: Mutex::new(None),
        }
    }
}

impl AppRuntime {
    pub fn set_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut guard) = self.app_handle.lock() {
            *guard = Some(handle);
        }
    }

    fn get_base_dir(&self) -> AppResult<PathBuf> {
        detect_base_dir(self.app_handle.lock().ok().and_then(|g| g.clone()))
    }

    pub fn inspect_state(&self) -> AppResult<AppStatePayload> {
        let base_dir = self.get_base_dir()?;
        ensure_runtime_layout(&base_dir)?;
        
        // 分离载荷检测逻辑
        let (payload_detected, payload_path) = self.find_payload(&base_dir);
        
        let config_path = base_dir.join("runtime").join("config").join("app-config.json");
        let config = AppConfig::load_or_create(&config_path)?;
        fs::create_dir_all(config.workspace_path(&base_dir))?;
        fs::create_dir_all(config.data_path(&base_dir))?;
        fs::create_dir_all(config.log_path(&base_dir))?;

        let device_fingerprint = get_device_fingerprint();
        let is_authorized = validate_license(&device_fingerprint, &config.license_key);

        let status = if self.is_running()? {
            RuntimeStatus::Running
        } else if !is_authorized {
            RuntimeStatus::Uninitialized
        } else if payload_detected {
            RuntimeStatus::Ready
        } else {
            RuntimeStatus::Uninitialized
        };

        let status_message = match status {
            RuntimeStatus::Running => "OpenClaw 进程正在运行".to_string(),
            RuntimeStatus::Ready => "运行载荷已检测，可执行启动".to_string(),
            RuntimeStatus::Uninitialized => if !is_authorized {
                "设备未授权，请输入授权码".to_string()
            } else {
                format!("未检测到运行载荷。检查路径: {}", payload_path)
            },
            RuntimeStatus::Failed => "运行失败".to_string(),
        };

        Ok(AppStatePayload {
            base_dir: base_dir.display().to_string(),
            runtime_dir: base_dir.join("runtime").display().to_string(),
            openclaw_dir: base_dir.join("runtime").join("openclaw").display().to_string(),
            workspace_dir: config.workspace_path(&base_dir).display().to_string(),
            config_path: config_path.display().to_string(),
            log_dir: config.log_path(&base_dir).display().to_string(),
            app_version: APP_VERSION.to_string(),
            status,
            status_message,
            payload_detected,
            payload_path,
            control_page_url: format!("http://{}:{}", config.bind_host, config.port),
            device_fingerprint,
            is_authorized,
            config,
        })
    }

    fn find_payload(&self, base_dir: &Path) -> (bool, String) {
        let mut checked_paths = Vec::new();

        // 1. 检查资源目录（针对打包后的环境，优先级最高）
        if let Ok(guard) = self.app_handle.lock() {
            if let Some(h) = guard.as_ref() {
                if let Ok(resource_dir) = h.path().resource_dir() {
                    // 路径 A: resource_dir/runtime/openclaw
                    if let Some(path) = detect_payload_entry(&resource_dir) {
                        return (true, path.display().to_string());
                    }
                    checked_paths.push(resource_dir.join("runtime").join("openclaw").display().to_string());

                    // 路径 B: resource_dir/_up_/runtime/openclaw
                    let up_dir = resource_dir.join("_up_");
                    if let Some(path) = detect_payload_entry(&up_dir) {
                        return (true, path.display().to_string());
                    }
                    checked_paths.push(up_dir.join("runtime").join("openclaw").display().to_string());
                }
            }
        }

        // 2. 检查 base_dir 下的载荷
        if let Some(path) = detect_payload_entry(base_dir) {
            return (true, path.display().to_string());
        }
        checked_paths.push(base_dir.join("runtime").join("openclaw").display().to_string());

        // 3. 检查当前可执行文件同级的载荷
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                if let Some(path) = detect_payload_entry(exe_dir) {
                    return (true, path.display().to_string());
                }
                checked_paths.push(exe_dir.join("runtime").join("openclaw").display().to_string());
            }
        }

        (false, checked_paths.join(" | "))
    }

    pub fn initialize_runtime(&self) -> AppResult<AppStatePayload> {
        let state = self.inspect_state()?;
        logger::append_line(&Path::new(&state.log_dir).join("app.log"), "runtime initialized")?;
        self.inspect_state()
    }

    pub fn save_config(&self, config: AppConfig) -> AppResult<AppStatePayload> {
        let base_dir = self.get_base_dir()?;
        ensure_runtime_layout(&base_dir)?;
        let path = base_dir.join("runtime").join("config").join("app-config.json");
        config.save(&path)?;
        logger::append_line(&base_dir.join("runtime").join("logs").join("app.log"), "config saved")?;
        self.inspect_state()
    }

    pub fn start(&self) -> AppResult<AppStatePayload> {
        let base_dir = self.get_base_dir()?;
        ensure_runtime_layout(&base_dir)?;
        if self.is_running()? {
          return self.inspect_state();
        }

        let config = AppConfig::load_or_create(&base_dir.join("runtime").join("config").join("app-config.json"))?;
        
        // 使用 find_payload 寻找实际载荷路径
        let (payload_detected, payload_entry_str) = self.find_payload(&base_dir);
        if !payload_detected {
            return Err(AppError::Message(format!("未找到 OpenClaw 运行载荷。检查路径: {}", payload_entry_str)));
        }
        let entry = PathBuf::from(payload_entry_str);

        let logs_dir = config.log_path(&base_dir);
        fs::create_dir_all(&logs_dir)?;
        fs::create_dir_all(config.workspace_path(&base_dir))?;
        fs::create_dir_all(config.data_path(&base_dir))?;
        let stdout = File::create(logs_dir.join("openclaw-stdout.log"))?;
        let stderr = File::create(logs_dir.join("openclaw-stderr.log"))?;
        logger::append_line(&logs_dir.join("app.log"), &format!("starting payload: {}", entry.display()))?;
        let agent_profile_path = write_agent_profile(&base_dir, &config)?;

        let child = build_command(&entry, &base_dir, &config, &agent_profile_path)
            .current_dir(config.workspace_path(&base_dir))
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()?;

        let mut guard = self.process.lock().map_err(|_| AppError::Message("进程状态锁不可用".into()))?;
        *guard = Some(ManagedProcess { child });
        self.inspect_state()
    }

    pub fn stop(&self) -> AppResult<AppStatePayload> {
        let base_dir = self.get_base_dir()?;
        let log_file = base_dir.join("runtime").join("logs").join("app.log");
        let mut guard = self.process.lock().map_err(|_| AppError::Message("进程状态锁不可用".into()))?;
        if let Some(process) = guard.as_mut() {
            let _ = process.child.kill();
            let _ = process.child.wait();
            logger::append_line(&log_file, "payload stopped")?;
        }
        *guard = None;
        self.inspect_state()
    }

    pub fn read_logs(&self) -> AppResult<LogBundle> {
        let base_dir = self.get_base_dir()?;
        let logs_dir = base_dir.join("runtime").join("logs");
        Ok(LogBundle {
            app: read_log_tail(&logs_dir.join("app.log"))?,
            stdout: read_log_tail(&logs_dir.join("openclaw-stdout.log"))?,
            stderr: read_log_tail(&logs_dir.join("openclaw-stderr.log"))?,
        })
    }

    pub fn open_logs_dir(&self) -> AppResult<()> {
        let base_dir = self.get_base_dir()?;
        let log_dir = base_dir.join("runtime").join("logs");
        fs::create_dir_all(&log_dir)?;
        Command::new("explorer.exe").arg(log_dir).spawn()?;
        Ok(())
    }

    pub fn open_install_dir(&self) -> AppResult<()> {
        let base_dir = self.get_base_dir()?;
        Command::new("explorer.exe").arg(base_dir).spawn()?;
        Ok(())
    }

    pub fn check_update(&self) -> AppResult<String> {
        Ok(format!("当前版本 {}，暂未配置自动更新渠道", APP_VERSION))
    }

    pub fn open_control_page<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>) -> AppResult<()> {
        let state = self.inspect_state()?;
        let url = state.control_page_url.parse().map_err(|_| AppError::Message("本地控制页 URL 解析失败".into()))?;
        if let Some(window) = app.get_webview_window("control-page") {
            window.show().map_err(|e| AppError::Message(e.to_string()))?;
            window.set_focus().map_err(|e| AppError::Message(e.to_string()))?;
            return Ok(());
        }

        WebviewWindowBuilder::new(app, "control-page", WebviewUrl::External(url))
            .title("OpenClaw 控制页")
            .inner_size(1180.0, 760.0)
            .build()
            .map_err(|e| AppError::Message(e.to_string()))?;
        Ok(())
    }

    fn is_running(&self) -> AppResult<bool> {
        let mut guard = self.process.lock().map_err(|_| AppError::Message("进程状态锁不可用".into()))?;
        if let Some(process) = guard.as_mut() {
            match process.child.try_wait()? {
                Some(_) => {
                    *guard = None;
                    Ok(false)
                }
                None => Ok(true),
            }
        } else {
            Ok(false)
        }
    }
}

fn detect_base_dir(handle: Option<tauri::AppHandle>) -> AppResult<PathBuf> {
    let current = std::env::current_dir()?;
    let exe_dir = std::env::current_exe()?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::Message("无法确定程序所在目录".into()))?;

    // 1. 检查当前工作目录（开发环境）
    if current.join("runtime").exists() || current.join("app").exists() {
        return Ok(current);
    }

    // 2. 检查可执行文件所在目录（便携版）
    if exe_dir.join("runtime").exists() {
        return Ok(exe_dir);
    }

    // 3. 如果是安装版本，资源目录可能是只读的，我们需要一个可写的目录来存放配置和日志
    // 我们优先选择 exe 所在目录，如果不可写，则回退到 APPDATA
    if is_writable(&exe_dir) {
        return Ok(exe_dir);
    }

    if let Some(h) = handle {
        if let Ok(app_data) = h.path().app_data_dir() {
            fs::create_dir_all(&app_data)?;
            return Ok(app_data);
        }
    }

    Ok(exe_dir)
}

fn is_writable(path: &Path) -> bool {
    let test_file = path.join(".write_test");
    match fs::write(&test_file, "test") {
        Ok(_) => {
            let _ = fs::remove_file(&test_file);
            true
        }
        Err(_) => false,
    }
}

fn ensure_runtime_layout(base_dir: &Path) -> AppResult<()> {
    for path in [
        base_dir.join("runtime"),
        base_dir.join("runtime").join("openclaw"),
        base_dir.join("runtime").join("workspace"),
        base_dir.join("runtime").join("config"),
        base_dir.join("runtime").join("logs"),
        base_dir.join("runtime").join("data"),
    ] {
        fs::create_dir_all(path)?;
    }
    let config_path = base_dir.join("runtime").join("config").join("app-config.json");
    if !config_path.exists() {
        AppConfig::default().save(&config_path)?;
    }
    Ok(())
}

fn detect_payload_entry(base_dir: &Path) -> Option<PathBuf> {
    let dir = base_dir.join("runtime").join("openclaw");
    for candidate in ["openclaw.exe", "OpenClaw.exe", "start.cmd", "start.bat", "launch.cmd", "launch.bat"] {
        let path = dir.join(candidate);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentProfilePayload {
    scenario: String,
    system_prompt: String,
    provider: String,
    model: String,
}

fn write_agent_profile(base_dir: &Path, config: &AppConfig) -> AppResult<PathBuf> {
    let path = base_dir.join("runtime").join("config").join("agent-profile.json");
    let payload = AgentProfilePayload {
        scenario: config.agent_scenario.clone(),
        system_prompt: config.agent_system_prompt.clone(),
        provider: config.provider.clone(),
        model: config.model.clone(),
    };
    let content = serde_json::to_string_pretty(&payload)?;
    fs::write(&path, content)?;
    Ok(path)
}

fn build_command(entry: &Path, base_dir: &Path, config: &AppConfig, agent_profile_path: &Path) -> Command {
    let extension = entry.extension().and_then(|item| item.to_str()).unwrap_or_default().to_ascii_lowercase();
    let mut command = if matches!(extension.as_str(), "cmd" | "bat") {
        let mut cmd = Command::new("cmd.exe");
        cmd.arg("/C").arg(entry);
        cmd
    } else {
        Command::new(entry)
    };

    command.env("OPENCLAW_PORT", config.port.to_string());
    command.env("OPENCLAW_BIND_HOST", &config.bind_host);
    command.env("OPENCLAW_BASE_DIR", base_dir);
    command.env("OPENCLAW_WORKSPACE_DIR", config.workspace_path(base_dir));
    command.env("OPENCLAW_CONFIG_DIR", base_dir.join("runtime").join("config"));
    command.env("OPENCLAW_DATA_DIR", config.data_path(base_dir));
    command.env("OPENCLAW_LOG_DIR", config.log_path(base_dir));
    command.env("OPENCLAW_PROVIDER", &config.provider);
    command.env("OPENCLAW_BASE_URL", &config.base_url);
    command.env("OPENCLAW_API_KEY", &config.api_key);
    command.env("OPENCLAW_MODEL", &config.model);
    command.env("OPENCLAW_AGENT_PROFILE", agent_profile_path);
    command.env("FEISHU_APP_ID", &config.feishu_app_id);
    command.env("FEISHU_APP_SECRET", &config.feishu_app_secret);
    command.env("FEISHU_ENCRYPT_KEY", &config.feishu_encrypt_key);
    command.env("FEISHU_VERIFICATION_TOKEN", &config.feishu_verification_token);
    command.arg(format!("--host={}", config.bind_host));
    command.arg(format!("--port={}", config.port));
    command.arg(format!("--workspace={}", config.workspace_path(base_dir).display()));
    command.arg(format!("--config-dir={}", base_dir.join("runtime").join("config").display()));
    command.arg(format!("--data-dir={}", config.data_path(base_dir).display()));
    command
}

fn read_log_tail(path: &Path) -> AppResult<String> {
    if !path.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(path)?;
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(200);
    Ok(lines[start..].join("\n"))
}

fn get_device_fingerprint() -> String {
    let mut hardware_ids = String::new();

    // 1. CPU ID
    if let Some(out) = Command::new("wmic").args(&["cpu", "get", "processorid"]).output().ok() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() > 1 {
            hardware_ids.push_str(lines[1].trim());
        }
    }

    // 2. Disk Serial Number
    if let Some(out) = Command::new("wmic").args(&["diskdrive", "get", "serialnumber"]).output().ok() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() > 1 {
            hardware_ids.push_str(lines[1].trim());
        }
    }

    // 3. Fallback to UUID if previous ones are empty
    if hardware_ids.trim().is_empty() {
        if let Some(out) = Command::new("wmic").args(&["csproduct", "get", "uuid"]).output().ok() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let lines: Vec<&str> = stdout.lines().collect();
            if lines.len() > 1 {
                hardware_ids.push_str(lines[1].trim());
            }
        }
    }

    if !hardware_ids.trim().is_empty() {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        hardware_ids.hash(&mut hasher);
        let hash = hasher.finish();
        return format!("CLAW-{:04X}-{:04X}", (hash >> 16) & 0xFFFF, hash & 0xFFFF);
    }
    
    "CLAW-0000-0000".to_string()
}

fn validate_license(fingerprint: &str, license_key: &str) -> bool {
    if license_key.is_empty() {
        return false;
    }
    use sha2::{Digest, Sha256};
    let raw = format!("{fingerprint}-OPENCLAW-SECRET-SALT");
    let digest = Sha256::digest(raw.as_bytes());
    let expected: String = digest
        .iter()
        .take(8)
        .map(|b| format!("{b:02X}"))
        .collect();
    license_key.trim().eq_ignore_ascii_case(&expected)
}
