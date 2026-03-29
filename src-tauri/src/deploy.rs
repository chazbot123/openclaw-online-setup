use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    fs::File,
    process::{Command, Stdio},
    sync::mpsc,
    sync::Mutex,
    time::Duration,
};
use tauri::{Emitter, Manager};

use crate::{
    config::AppConfig,
    error::{AppError, AppResult},
    runtime::AppRuntime,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn apply_no_window(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvItem {
    pub id: String,
    pub name: String,
    pub required: bool,
    pub installed: bool,
    pub version: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployEvent {
    pub step_id: String,
    pub status: String,
    pub message: String,
    pub progress: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploySnapshot {
    pub running: bool,
    pub last_event: Option<DeployEvent>,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub running: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayLogs {
    pub stdout: String,
    pub stderr: String,
}

pub struct DeployEngine {
    state: Mutex<DeployState>,
    gateway: Mutex<Option<ManagedGateway>>,
}

struct DeployState {
    running: bool,
    last_event: Option<DeployEvent>,
    lines: Vec<String>,
}

struct ManagedGateway {
    child: std::process::Child,
}

impl Default for DeployEngine {
    fn default() -> Self {
        Self {
            state: Mutex::new(DeployState {
                running: false,
                last_event: None,
                lines: Vec::new(),
            }),
            gateway: Mutex::new(None),
        }
    }
}

impl DeployEngine {
    pub fn snapshot(&self) -> DeploySnapshot {
        let guard = self.state.lock().ok();
        let Some(guard) = guard else {
            return DeploySnapshot {
                running: false,
                last_event: None,
                output: String::new(),
            };
        };
        DeploySnapshot {
            running: guard.running,
            last_event: guard.last_event.clone(),
            output: guard.lines.join("\n"),
        }
    }

    pub fn env_status(&self, runtime: &AppRuntime) -> AppResult<Vec<EnvItem>> {
        let base_dir = runtime.inspect_state()?.base_dir;
        let base_dir = PathBuf::from(base_dir);
        let tools_dir = tools_dir(&base_dir);
        let tools_bin = tools_dir.join("bin");
        let npm_global_bin = npm_global_bin_dir(&base_dir);

        let node = detect_tool(
            &["node.exe", "node", "node.cmd"],
            &tools_bin,
            &npm_global_bin,
            &tools_dir,
            &base_dir,
            &["--version"],
            &["node", "--version"],
        );
        let npm = detect_tool(
            &["npm.cmd", "npm", "npm.ps1"],
            &tools_bin,
            &npm_global_bin,
            &tools_dir,
            &base_dir,
            &["--version"],
            &["npm", "--version"],
        );
        let git = detect_tool(
            &["git.exe", "git"],
            &tools_bin,
            &npm_global_bin,
            &tools_dir,
            &base_dir,
            &["--version"],
            &["git", "--version"],
        );
        let openclaw = detect_tool(
            &["openclaw.exe", "openclaw.cmd", "openclaw.ps1", "openclaw"],
            &tools_bin,
            &npm_global_bin,
            &tools_dir,
            &base_dir,
            &["--version"],
            &["openclaw", "--version"],
        );

        Ok(vec![
            EnvItem {
                id: "node".into(),
                name: "Node.js".into(),
                required: true,
                installed: node.installed,
                version: node.version,
                detail: node.detail,
            },
            EnvItem {
                id: "npm".into(),
                name: "npm".into(),
                required: true,
                installed: npm.installed,
                version: npm.version,
                detail: npm.detail,
            },
            EnvItem {
                id: "git".into(),
                name: "Git（可选）".into(),
                required: false,
                installed: git.installed,
                version: git.version,
                detail: git.detail,
            },
            EnvItem {
                id: "openclaw".into(),
                name: "OpenClaw".into(),
                required: true,
                installed: openclaw.installed,
                version: openclaw.version,
                detail: openclaw.detail,
            },
        ])
    }

    pub fn start_deploy(&self, app: tauri::AppHandle) -> AppResult<()> {
        {
            let mut guard = self.state.lock().map_err(|_| AppError::Message("部署引擎状态锁不可用".into()))?;
            if guard.running {
                return Err(AppError::Message("部署任务正在运行".into()));
            }
            guard.running = true;
            guard.lines.clear();
            guard.last_event = Some(DeployEvent {
                step_id: "init".into(),
                status: "running".into(),
                message: "开始部署".into(),
                progress: 0,
            });
        }
        emit_event(&app, self, DeployEvent {
            step_id: "init".into(),
            status: "running".into(),
            message: "开始部署".into(),
            progress: 0,
        });

        tauri::async_runtime::spawn(async move {
            let result = (|| -> AppResult<()> {
                let runtime = app.state::<AppRuntime>();
                let engine = app.state::<DeployEngine>();
                let state = runtime.inspect_state()?;
                let base_dir = PathBuf::from(state.base_dir);
                let tools_dir = tools_dir(&base_dir);
                let tools_bin = tools_dir.join("bin");
                let npm_global_bin = npm_global_bin_dir(&base_dir);

                emit_event(&app, &engine, DeployEvent {
                    step_id: "node".into(),
                    status: "running".into(),
                    message: "检查 Node.js".into(),
                    progress: 5,
                });
                let node = detect_tool(
                    &["node.exe", "node", "node.cmd"],
                    &tools_bin,
                    &npm_global_bin,
                    &tools_dir,
                    &base_dir,
                    &["--version"],
                    &["node", "--version"],
                );
                if !node.installed {
                    emit_event(&app, &engine, DeployEvent {
                        step_id: "node".into(),
                        status: "running".into(),
                        message: "安装 Node.js（国内源）".into(),
                        progress: 10,
                    });
                    install_node_cn(&app, &engine, &base_dir)?;
                }
                emit_event(&app, &engine, DeployEvent {
                    step_id: "node".into(),
                    status: "success".into(),
                    message: "Node.js 已就绪".into(),
                    progress: 30,
                });

                emit_event(&app, &engine, DeployEvent {
                    step_id: "npm".into(),
                    status: "running".into(),
                    message: "设置 npm 国内源".into(),
                    progress: 35,
                });
                configure_npm_cn(&app, &engine, &base_dir)?;
                emit_event(&app, &engine, DeployEvent {
                    step_id: "npm".into(),
                    status: "success".into(),
                    message: "npm 已就绪".into(),
                    progress: 45,
                });

                emit_event(&app, &engine, DeployEvent {
                    step_id: "openclaw".into(),
                    status: "running".into(),
                    message: "检查 OpenClaw".into(),
                    progress: 55,
                });
                let mut openclaw = detect_tool(
                    &["openclaw.exe", "openclaw.cmd", "openclaw.ps1", "openclaw"],
                    &tools_bin,
                    &npm_global_bin,
                    &tools_dir,
                    &base_dir,
                    &["--version"],
                    &["openclaw", "--version"],
                );
                if !openclaw.installed {
                    emit_event(&app, &engine, DeployEvent {
                        step_id: "openclaw".into(),
                        status: "running".into(),
                        message: "npm 全局安装 OpenClaw（国内源）".into(),
                        progress: 65,
                    });
                    install_openclaw_cn(&app, &engine, &base_dir)?;
                    openclaw = detect_tool(
                        &["openclaw.exe", "openclaw.cmd", "openclaw.ps1", "openclaw"],
                        &tools_bin,
                        &npm_global_bin,
                        &tools_dir,
                        &base_dir,
                        &["--version"],
                        &["openclaw", "--version"],
                    );
                    if !openclaw.installed {
                        emit_event(&app, &engine, DeployEvent {
                            step_id: "openclaw".into(),
                            status: "error".into(),
                            message: "OpenClaw 安装失败，请查看安装输出。".into(),
                            progress: 100,
                        });
                        return Err(AppError::Message("OpenClaw 安装失败".into()));
                    }
                }
                emit_event(&app, &engine, DeployEvent {
                    step_id: "openclaw".into(),
                    status: "success".into(),
                    message: "OpenClaw 已就绪".into(),
                    progress: 90,
                });

                let config = AppConfig::load_or_create(&base_dir.join("runtime").join("config").join("app-config.json"))?;
                if !config.feishu_app_id.trim().is_empty() && !config.feishu_app_secret.trim().is_empty() {
                    emit_event(&app, &engine, DeployEvent {
                        step_id: "feishu-skill".into(),
                        status: "running".into(),
                        message: "安装并配置飞书通道".into(),
                        progress: 93,
                    });
                    match ensure_channel_ready(&app, &engine, &base_dir, &config, "feishu") {
                        Ok(_) => {
                            emit_event(&app, &engine, DeployEvent {
                                step_id: "feishu-skill".into(),
                                status: "success".into(),
                                message: "飞书通道已就绪".into(),
                                progress: 94,
                            });
                        }
                        Err(err) => {
                            emit_event(&app, &engine, DeployEvent {
                                step_id: "feishu-skill".into(),
                                status: "warning".into(),
                                message: format!("飞书通道自动配置失败：{}，可在控制台手动配置后继续。", err),
                                progress: 94,
                            });
                        }
                    }
                }
                if config.wechat_enabled {
                    emit_event(&app, &engine, DeployEvent {
                        step_id: "wechat-skill".into(),
                        status: "running".into(),
                        message: "安装微信插件（扫码登录请在部署情况页触发）".into(),
                        progress: 95,
                    });
                    match ensure_channel_ready(&app, &engine, &base_dir, &config, "wechat") {
                        Ok(_) => {
                            emit_event(&app, &engine, DeployEvent {
                                step_id: "wechat-skill".into(),
                                status: "success".into(),
                                message: "微信通道已就绪".into(),
                                progress: 98,
                            });
                        }
                        Err(err) => {
                            emit_event(&app, &engine, DeployEvent {
                                step_id: "wechat-skill".into(),
                                status: "warning".into(),
                                message: format!("微信通道自动配置失败：{}，可在控制台手动配置后继续。", err),
                                progress: 98,
                            });
                        }
                    }
                }

                if config.provider != "OpenClawCard" && !config.api_key.trim().is_empty() {
                    emit_event(&app, &engine, DeployEvent {
                        step_id: "model-apply".into(),
                        status: "running".into(),
                        message: format!("应用预填模型配置：{} / {}", config.provider, config.model),
                        progress: 99,
                    });
                    let message = engine.gateway_start(runtime.inner())?;
                    emit_event(&app, &engine, DeployEvent {
                        step_id: "model-apply".into(),
                        status: "success".into(),
                        message: format!("模型配置已生效，{}", message),
                        progress: 99,
                    });
                }

                emit_event(&app, &engine, DeployEvent {
                    step_id: "done".into(),
                    status: "success".into(),
                    message: "部署完成".into(),
                    progress: 100,
                });
                Ok(())
            })();

            let engine = app.state::<DeployEngine>();
            if let Ok(mut g) = engine.state.lock() {
                g.running = false;
            }

            if let Err(err) = result {
                emit_event(&app, &engine, DeployEvent {
                    step_id: "done".into(),
                    status: "error".into(),
                    message: err.to_string(),
                    progress: 100,
                });
            }
        });

        Ok(())
    }

    pub fn openclaw_dashboard(&self, runtime: &AppRuntime) -> AppResult<()> {
        let base_dir = PathBuf::from(runtime.inspect_state()?.base_dir);
        let config = AppConfig::load_or_create(&base_dir.join("runtime").join("config").join("app-config.json"))?;
        sync_openclaw_auth_profiles(&config)?;
        let resolved_provider = resolve_provider_slug(&config.provider, &config.model);
        let resolved_model = resolve_model_id(&config.provider, &config.model);
        let tools_bin = tools_dir(&base_dir).join("bin");
        let npm_global = npm_global_bin_dir(&base_dir);
        let mut cmd = Command::new("powershell.exe");
        apply_no_window(&mut cmd);
        cmd.arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-Command")
            .arg("openclaw dashboard")
            .env(
                "PATH",
                format!(
                    "{};{};{}",
                    tools_bin.display(),
                    npm_global.display(),
                    std::env::var("PATH").unwrap_or_default()
                ),
            );
        cmd.env("OPENCLAW_PROVIDER", &resolved_provider)
            .env("OPENCLAW_BASE_URL", &config.base_url)
            .env("OPENCLAW_API_KEY", &config.api_key)
            .env("OPENCLAW_MODEL", &resolved_model);
        apply_provider_env_to_command(&mut cmd, &resolved_provider, &config.api_key, &config.base_url);
        cmd
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| AppError::Message(e.to_string()))?;
        Ok(())
    }

    pub fn wechat_start_login(&self, runtime: &AppRuntime) -> AppResult<String> {
        let base_dir = PathBuf::from(runtime.inspect_state()?.base_dir);
        let tools_bin = tools_dir(&base_dir).join("bin");
        let npm_global = npm_global_bin_dir(&base_dir);
        let cli_path = tools_dir(&base_dir)
            .join("npm-global")
            .join("node_modules")
            .join("@tencent-weixin")
            .join("openclaw-weixin-cli")
            .join("cli.mjs");
        let script = format!(
            "$env:PATH='{tools};{global};'+$env:PATH; \
             npm.cmd install -g @tencent-weixin/openclaw-weixin-cli --registry https://registry.npmmirror.com; \
             if (Test-Path '{cli}') {{ node '{cli}' install }} else {{ openclaw channels login --channel openclaw-weixin }}",
            tools = tools_bin.display(),
            global = npm_global.display(),
            cli = cli_path.display()
        );
        let mut cmd = Command::new("powershell.exe");
        cmd.arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-NoExit")
            .arg("-Command")
            .arg(script)
            .spawn()
            .map_err(|e| AppError::Message(e.to_string()))?;
        Ok("已打开微信扫码终端，请在弹出窗口中扫描二维码".into())
    }

    pub fn gateway_start(&self, runtime: &AppRuntime) -> AppResult<String> {
        let base_dir = PathBuf::from(runtime.inspect_state()?.base_dir);
        let config = AppConfig::load_or_create(&base_dir.join("runtime").join("config").join("app-config.json"))?;
        sync_openclaw_auth_profiles(&config)?;
        let resolved_provider = resolve_provider_slug(&config.provider, &config.model);
        let resolved_model = resolve_model_id(&config.provider, &config.model);
        let tools_bin = tools_dir(&base_dir).join("bin");
        let npm_global = npm_global_bin_dir(&base_dir);
        let logs_dir = base_dir.join("runtime").join("logs");
        std::fs::create_dir_all(&logs_dir)?;

        let mut guard = self.gateway.lock().map_err(|_| AppError::Message("网关状态锁不可用".into()))?;
        if let Some(process) = guard.as_mut() {
            match process.child.try_wait() {
                Ok(Some(_)) => {
                    *guard = None;
                }
                Ok(None) => return Ok("网关已在运行中".into()),
                Err(_) => {
                    *guard = None;
                }
            }
        }

        let stdout = File::create(logs_dir.join("openclaw-gateway-stdout.log"))?;
        let stderr = File::create(logs_dir.join("openclaw-gateway-stderr.log"))?;

        let script = format!(
            "$ErrorActionPreference='Stop'; \
             $env:PATH='{tools};{global};'+$env:PATH; \
             try {{ openclaw gateway stop | Out-Null }} catch {{}}; \
             $env:OPENCLAW_PROVIDER='{provider}'; \
             $env:OPENCLAW_BASE_URL='{base_url}'; \
             $env:OPENCLAW_API_KEY='{api_key}'; \
             $env:OPENCLAW_MODEL='{model}'; \
             {provider_env_lines}\
             try {{ openclaw models set '{model}' | Out-Null }} catch {{}}; \
             $env:OPENCLAW_PORT='{port}'; \
             $env:OPENCLAW_BIND_HOST='{bind_host}'; \
             $env:FEISHU_APP_ID='{feishu_app_id}'; \
             $env:FEISHU_APP_SECRET='{feishu_app_secret}'; \
             $env:FEISHU_ENCRYPT_KEY='{feishu_encrypt_key}'; \
             $env:FEISHU_VERIFICATION_TOKEN='{feishu_verification_token}'; \
             $env:WECHAT_ENABLED='{wechat_enabled}'; \
             $env:WECHAT_MODE='{wechat_mode}'; \
             $env:WECHAT_DM_POLICY='{wechat_dm_policy}'; \
             $env:WECHAT_PAIRING_MESSAGE='{wechat_pairing_message}'; \
             $env:WECHAT_GROUP_POLICY='{wechat_group_policy}'; \
             $env:WECHAT_ALLOW_GROUPS='{wechat_allow_groups}'; \
             $env:WECHAT_TRIGGER_KEYWORD='{wechat_trigger_keyword}'; \
             openclaw gateway run --allow-unconfigured --force",
            tools = tools_bin.display(),
            global = npm_global.display(),
            provider = ps_single_quote(&resolved_provider),
            base_url = ps_single_quote(&config.base_url),
            api_key = ps_single_quote(&config.api_key),
            model = ps_single_quote(&resolved_model),
            provider_env_lines = provider_env_lines(&resolved_provider, &config.api_key, &config.base_url),
            port = config.port,
            bind_host = ps_single_quote(&config.bind_host),
            feishu_app_id = ps_single_quote(&config.feishu_app_id),
            feishu_app_secret = ps_single_quote(&config.feishu_app_secret),
            feishu_encrypt_key = ps_single_quote(&config.feishu_encrypt_key),
            feishu_verification_token = ps_single_quote(&config.feishu_verification_token),
            wechat_enabled = if config.wechat_enabled { "true" } else { "false" },
            wechat_mode = ps_single_quote(&config.wechat_mode),
            wechat_dm_policy = ps_single_quote(&config.wechat_dm_policy),
            wechat_pairing_message = ps_single_quote(&config.wechat_pairing_message),
            wechat_group_policy = ps_single_quote(&config.wechat_group_policy),
            wechat_allow_groups = ps_single_quote(&config.wechat_allow_groups),
            wechat_trigger_keyword = ps_single_quote(&config.wechat_trigger_keyword)
        );

        let mut cmd = Command::new("powershell.exe");
        apply_no_window(&mut cmd);
        cmd.arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-Command")
            .arg(script)
            .current_dir(&base_dir)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));

        let child = cmd.spawn().map_err(|e| AppError::Message(e.to_string()))?;
        *guard = Some(ManagedGateway { child });
        Ok("网关启动已发起，请稍候再打开 Dashboard".into())
    }

    pub fn gateway_stop(&self, runtime: &AppRuntime) -> AppResult<String> {
        let base_dir = PathBuf::from(runtime.inspect_state()?.base_dir);
        let tools_bin = tools_dir(&base_dir).join("bin");
        let npm_global = npm_global_bin_dir(&base_dir);

        let mut guard = self.gateway.lock().map_err(|_| AppError::Message("网关状态锁不可用".into()))?;
        if let Some(mut process) = guard.take() {
            let _ = process.child.kill();
            let _ = process.child.wait();
            return Ok("网关已停止".into());
        }

        let arg_line = ["gateway", "stop"].join(" ");
        let script = format!(
            "$ErrorActionPreference='SilentlyContinue'; $env:PATH='{tools};{global};'+$env:PATH; openclaw {args}",
            tools = tools_bin.display(),
            global = npm_global.display(),
            args = arg_line
        );

        let mut cmd = Command::new("powershell.exe");
        apply_no_window(&mut cmd);
        cmd.arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-Command")
            .arg(script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let out = run_command_with_timeout(cmd, Duration::from_secs(6));
        let Some(out) = out else {
            return Ok("已尝试停止网关".into());
        };
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(if stdout.is_empty() { "已尝试停止网关".into() } else { stdout })
    }

    pub fn gateway_status(&self) -> GatewayStatus {
        let mut running = false;
        if let Ok(mut guard) = self.gateway.lock() {
            if let Some(process) = guard.as_mut() {
                match process.child.try_wait() {
                    Ok(Some(_)) => {
                        *guard = None;
                        running = false;
                    }
                    Ok(None) => running = true,
                    Err(_) => {
                        *guard = None;
                        running = false;
                    }
                }
            }
        }
        GatewayStatus {
            running,
            message: if running { "运行中".into() } else { "未运行".into() },
        }
    }

    pub fn read_gateway_logs(&self, runtime: &AppRuntime) -> AppResult<GatewayLogs> {
        let base_dir = PathBuf::from(runtime.inspect_state()?.base_dir);
        let logs_dir = base_dir.join("runtime").join("logs");
        let stdout = read_tail(&logs_dir.join("openclaw-gateway-stdout.log"), 200)?;
        let stderr = read_tail(&logs_dir.join("openclaw-gateway-stderr.log"), 200)?;
        Ok(GatewayLogs { stdout, stderr })
    }

}

fn read_tail(path: &Path, max_lines: usize) -> AppResult<String> {
    if !path.exists() {
        return Ok(String::new());
    }
    let content = std::fs::read_to_string(path)?;
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    Ok(lines[start..].join("\n"))
}

struct ToolDetectResult {
    installed: bool,
    version: String,
    detail: String,
}

fn tools_dir(base_dir: &Path) -> PathBuf {
    let p = base_dir.join("tools");
    if p.is_absolute() {
        return p;
    }
    p
}

fn npm_global_bin_dir(base_dir: &Path) -> PathBuf {
    tools_dir(base_dir).join("npm-global")
}

fn detect_tool(
    names: &[&str],
    tools_bin: &Path,
    extra_bin: &Path,
    tools_dir: &Path,
    base_dir: &Path,
    version_args: &[&str],
    version_cmd: &[&str],
) -> ToolDetectResult {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for name in names {
        candidates.push(tools_bin.join(name));
        candidates.push(extra_bin.join(name));
        candidates.push(tools_dir.join(name));
        candidates.push(base_dir.join(name));
    }

    for path in candidates {
        if path.exists() {
            let version = run_command_capture_with_env(&path, version_args, tools_bin, Duration::from_secs(3)).unwrap_or_default();
            return ToolDetectResult {
                installed: true,
                version: version.trim().to_string(),
                detail: format!("内置目录: {}", path.display()),
            };
        }
    }

    let version = run_powershell_capture(
        &format!("$ErrorActionPreference='SilentlyContinue'; {} 2>$null", version_cmd.join(" ")),
        tools_bin,
        extra_bin,
        Duration::from_secs(3),
    )
    .unwrap_or_default();

    if version.trim().is_empty() {
        ToolDetectResult {
            installed: false,
            version: "".into(),
            detail: "未安装".into(),
        }
    } else {
        ToolDetectResult {
            installed: true,
            version: version.trim().to_string(),
            detail: "系统已安装".into(),
        }
    }
}

fn emit_event(app: &tauri::AppHandle, engine: &DeployEngine, event: DeployEvent) {
    if let Ok(mut guard) = engine.state.lock() {
        guard.last_event = Some(event.clone());
        guard.lines.push(format!("[{}] {}", event.step_id, event.message));
        if guard.lines.len() > 600 {
            let overflow = guard.lines.len() - 600;
            guard.lines.drain(0..overflow);
        }
    }
    let _ = app.emit("deploy_progress", event);
}

fn append_output(app: &tauri::AppHandle, engine: &DeployEngine, line: &str) {
    if let Ok(mut guard) = engine.state.lock() {
        guard.lines.push(line.to_string());
        if guard.lines.len() > 1200 {
            let overflow = guard.lines.len() - 1200;
            guard.lines.drain(0..overflow);
        }
    }
    let _ = app.emit("deploy_output", line.to_string());
}

fn run_powershell_capture(script: &str, tools_bin: &Path, extra_bin: &Path, timeout: Duration) -> Option<String> {
    let mut cmd = Command::new("powershell.exe");
    apply_no_window(&mut cmd);
    cmd.arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .env(
            "PATH",
            format!(
                "{};{};{}",
                tools_bin.display(),
                extra_bin.display(),
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    run_command_with_timeout(cmd, timeout).and_then(|out| String::from_utf8(out.stdout).ok())
}

fn run_command_capture_with_env(bin: &Path, args: &[&str], tools_bin: &Path, timeout: Duration) -> Option<String> {
    let mut cmd = Command::new(bin);
    apply_no_window(&mut cmd);
    cmd.args(args)
        .env("PATH", format!("{};{}", tools_bin.display(), std::env::var("PATH").unwrap_or_default()))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    run_command_with_timeout(cmd, timeout).and_then(|out| String::from_utf8(out.stdout).ok())
}

fn run_command_with_timeout(mut cmd: Command, timeout: Duration) -> Option<std::process::Output> {
    use std::time::Instant;
    apply_no_window(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

fn install_node_cn(app: &tauri::AppHandle, engine: &DeployEngine, base_dir: &Path) -> AppResult<()> {
    let tools_dir = tools_dir(base_dir);
    let node_version = "v24.14.0";
    let node_zip = format!("node-{}-win-x64.zip", node_version);
    let node_url = format!(
        "https://registry.npmmirror.com/-/binary/node/{}/{}",
        node_version, node_zip
    );

    let script = format!(
        "$ErrorActionPreference='Stop';\
         $base='{base}';\
         $toolsBin=Join-Path $base 'bin';\
         $nodeDir=Join-Path $base 'node\\\\{ver}';\
         $nodeExe=Join-Path $nodeDir 'node.exe';\
         if (-not (Test-Path $nodeExe)) {{\
           New-Item -ItemType Directory -Force $nodeDir | Out-Null;\
           $tmp=Join-Path $env:TEMP '{zip}';\
           Invoke-WebRequest -UseBasicParsing -Uri '{url}' -OutFile $tmp;\
           $extract=Join-Path $env:TEMP ('node-'+[Guid]::NewGuid().ToString());\
           Expand-Archive -Force -Path $tmp -DestinationPath $extract;\
           $src=Join-Path $extract 'node-{ver}-win-x64';\
           Copy-Item -Recurse -Force (Join-Path $src '*') $nodeDir;\
           Remove-Item -Recurse -Force $extract;\
         }};\
         New-Item -ItemType Directory -Force $toolsBin | Out-Null;\
         $nodeCmd=Join-Path $toolsBin 'node.cmd';\
         Set-Content -Encoding ASCII -Path $nodeCmd -Value ('@echo off`r`n\"'+$nodeExe+'\" %*');\
         $npmCmd=Join-Path $toolsBin 'npm.cmd';\
         $npmCli=Join-Path $nodeDir 'node_modules\\\\npm\\\\bin\\\\npm-cli.js';\
         Set-Content -Encoding ASCII -Path $npmCmd -Value ('@echo off`r`n\"'+$nodeExe+'\" \"'+$npmCli+'\" %*');\
         $cur=[Environment]::GetEnvironmentVariable('Path','User');\
         if (-not $cur) {{ $cur='' }};\
         if ($cur -notlike ('*'+$toolsBin+'*')) {{\
           [Environment]::SetEnvironmentVariable('Path', ($toolsBin+';'+$cur), 'User');\
         }}",
        base = tools_dir.display(),
        ver = node_version,
        url = node_url,
        zip = node_zip
    );

    run_powershell_stream(app, engine, "node", &script, &tools_dir.join("bin"), Path::new(""), Duration::from_secs(180))
}

fn configure_npm_cn(app: &tauri::AppHandle, engine: &DeployEngine, base_dir: &Path) -> AppResult<()> {
    let tools_dir = tools_dir(base_dir);
    let tools_bin = tools_dir.join("bin");
    let npm_global = npm_global_bin_dir(base_dir);
    let script = format!(
        "$ErrorActionPreference='Stop';\
         $env:PATH='{bin};'+$env:PATH;\
         $prefix='{prefix}';\
         New-Item -ItemType Directory -Force $prefix | Out-Null;\
         npm.cmd config set registry https://registry.npmmirror.com;\
         npm.cmd config set fund false;\
         npm.cmd config set audit false;\
         npm.cmd config set prefix $prefix;\
         $cur=[Environment]::GetEnvironmentVariable('Path','User');\
         if (-not $cur) {{ $cur='' }};\
         if ($cur -notlike ('*'+$prefix+'*')) {{\
           [Environment]::SetEnvironmentVariable('Path', ($prefix+';'+$cur), 'User');\
         }}",
        bin = tools_bin.display(),
        prefix = npm_global.display()
    );
    run_powershell_stream(app, engine, "npm", &script, &tools_bin, &npm_global, Duration::from_secs(60))
}

fn install_openclaw_cn(app: &tauri::AppHandle, engine: &DeployEngine, base_dir: &Path) -> AppResult<()> {
    let tools_dir = tools_dir(base_dir);
    let tools_bin = tools_dir.join("bin");
    let npm_global = npm_global_bin_dir(base_dir);
    let script = format!(
        "$ErrorActionPreference='Stop';\
         $env:PATH='{bin};{prefix};'+$env:PATH;\
         npm.cmd config set registry https://registry.npmmirror.com;\
         npm.cmd install -g openclaw --registry https://registry.npmmirror.com",
        bin = tools_bin.display(),
        prefix = npm_global.display()
    );
    run_powershell_stream(app, engine, "openclaw", &script, &tools_bin, &npm_global, Duration::from_secs(900))
}

fn ensure_channel_ready(app: &tauri::AppHandle, engine: &DeployEngine, base_dir: &Path, config: &AppConfig, channel: &str) -> AppResult<()> {
    let tools_dir = tools_dir(base_dir);
    let tools_bin = tools_dir.join("bin");
    let npm_global = npm_global_bin_dir(base_dir);
    let script = format!(
        "$ErrorActionPreference='Stop';\
         $env:PATH='{bin};{prefix};'+$env:PATH;\
         $env:FEISHU_APP_ID='{feishu_app_id}';\
         $env:FEISHU_APP_SECRET='{feishu_app_secret}';\
         $env:FEISHU_ENCRYPT_KEY='{feishu_encrypt_key}';\
         $env:FEISHU_VERIFICATION_TOKEN='{feishu_verification_token}';\
         if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {{ throw '未找到 openclaw 命令' }};\
         if ('{channel}' -eq 'feishu') {{\
           openclaw plugins enable feishu | Out-Null;\
           if ($LASTEXITCODE -ne 0) {{ throw '启用 feishu 插件失败' }};\
           if ('{feishu_app_id}' -ne '') {{ openclaw config set channels.feishu.appId '{feishu_app_id}' | Out-Null }};\
           if ($LASTEXITCODE -ne 0) {{ throw '写入 channels.feishu.appId 失败' }};\
           if ('{feishu_app_secret}' -ne '') {{ openclaw config set channels.feishu.appSecret '{feishu_app_secret}' | Out-Null }};\
           if ($LASTEXITCODE -ne 0) {{ throw '写入 channels.feishu.appSecret 失败' }};\
           if ('{feishu_verification_token}' -ne '') {{ openclaw config set channels.feishu.verificationToken '{feishu_verification_token}' | Out-Null }};\
           if ($LASTEXITCODE -ne 0) {{ throw '写入 channels.feishu.verificationToken 失败' }};\
           if ('{feishu_encrypt_key}' -ne '') {{ openclaw config set channels.feishu.encryptKey '{feishu_encrypt_key}' | Out-Null }};\
           if ($LASTEXITCODE -ne 0) {{ throw '写入 channels.feishu.encryptKey 失败' }};\
           openclaw channels add --channel feishu --name default | Out-Null;\
           if ($LASTEXITCODE -ne 0) {{ throw '配置 feishu 通道失败' }};\
           exit 0;\
         }};\
         if ('{channel}' -eq 'wechat') {{\
           openclaw plugins install '@tencent-weixin/openclaw-weixin@latest' | Out-Null;\
           if ($LASTEXITCODE -ne 0) {{\
             openclaw plugins install '@tencent-weixin/openclaw-weixin@compat-host-gte2026.3.0-lt2026.3.22' | Out-Null;\
           }};\
           if ($LASTEXITCODE -ne 0) {{ throw '安装 openclaw-weixin 插件失败' }};\
           openclaw plugins enable openclaw-weixin | Out-Null;\
           if ($LASTEXITCODE -ne 0) {{ throw '启用 openclaw-weixin 插件失败' }};\
           exit 0;\
         }};\
         throw '未知通道类型'",
        bin = tools_bin.display(),
        prefix = npm_global.display(),
        channel = channel,
        feishu_app_id = ps_single_quote(&config.feishu_app_id),
        feishu_app_secret = ps_single_quote(&config.feishu_app_secret),
        feishu_encrypt_key = ps_single_quote(&config.feishu_encrypt_key),
        feishu_verification_token = ps_single_quote(&config.feishu_verification_token)
    );
    run_powershell_stream(app, engine, "channel", &script, &tools_bin, &npm_global, Duration::from_secs(180))
}

fn ps_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

fn provider_api_env_keys(provider: &str) -> &'static [&'static str] {
    match canonical_provider_slug(provider).as_str() {
        "openai" => &["OPENAI_API_KEY"],
        "anthropic" => &["ANTHROPIC_API_KEY"],
        "google" => &["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
        "xai" => &["XAI_API_KEY", "GROK_API_KEY"],
        "zai" => &["ZAI_API_KEY", "Z_AI_API_KEY", "GLM_API_KEY", "ZHIPUAI_API_KEY", "BIGMODEL_API_KEY"],
        "kimi" => &["KIMI_API_KEY", "MOONSHOT_API_KEY"],
        "deepseek" => &["DEEPSEEK_API_KEY"],
        "minimax" => &["MINIMAX_API_KEY"],
        _ => &[],
    }
}

fn universal_model_api_env_keys() -> &'static [&'static str] {
    &[
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
        "XAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "KIMI_API_KEY",
        "MOONSHOT_API_KEY",
        "MINIMAX_API_KEY",
        "ZAI_API_KEY",
        "Z_AI_API_KEY",
    ]
}

fn provider_base_url_env_keys(provider: &str) -> &'static [&'static str] {
    match canonical_provider_slug(provider).as_str() {
        "openai" => &["OPENAI_BASE_URL"],
        "anthropic" => &["ANTHROPIC_BASE_URL"],
        "google" => &["GOOGLE_BASE_URL", "GEMINI_BASE_URL"],
        "xai" => &["XAI_BASE_URL", "GROK_BASE_URL"],
        "zai" => &["ZAI_BASE_URL", "Z_AI_BASE_URL", "GLM_BASE_URL", "ZHIPUAI_BASE_URL", "BIGMODEL_BASE_URL"],
        "kimi" => &["KIMI_BASE_URL", "MOONSHOT_BASE_URL"],
        "deepseek" => &["DEEPSEEK_BASE_URL"],
        "minimax" => &["MINIMAX_BASE_URL"],
        _ => &[],
    }
}

fn apply_provider_env_to_command(cmd: &mut Command, provider: &str, api_key: &str, base_url: &str) {
    for key in universal_model_api_env_keys() {
        cmd.env(key, api_key);
    }
    for key in provider_api_env_keys(provider) {
        cmd.env(key, api_key);
    }
    for key in provider_base_url_env_keys(provider) {
        cmd.env(key, base_url);
    }
}

fn provider_env_lines(provider: &str, api_key: &str, base_url: &str) -> String {
    let api = ps_single_quote(api_key);
    let base = ps_single_quote(base_url);
    let mut parts: Vec<String> = Vec::new();
    for key in universal_model_api_env_keys() {
        parts.push(format!("$env:{key}='{api}'; "));
    }
    for key in provider_api_env_keys(provider) {
        parts.push(format!("$env:{key}='{api}'; "));
    }
    for key in provider_base_url_env_keys(provider) {
        parts.push(format!("$env:{key}='{base}'; "));
    }
    parts.join("")
}

fn provider_auth_profile_ids(provider: &str) -> &'static [&'static str] {
    match canonical_provider_slug(provider).as_str() {
        "openai" => &["openai"],
        "anthropic" => &["anthropic"],
        "google" => &["google", "gemini"],
        "xai" => &["xai"],
        "zai" => &["zai", "glm", "zhipuai"],
        "kimi" => &["moonshot", "kimi"],
        "deepseek" => &["deepseek"],
        "minimax" => &["minimax"],
        _ => &[],
    }
}

fn sync_openclaw_auth_profiles(config: &AppConfig) -> AppResult<()> {
    if config.api_key.trim().is_empty() {
        return Ok(());
    }
    let Some(user_profile) = std::env::var_os("USERPROFILE") else {
        return Ok(());
    };
    let agent_dir = PathBuf::from(user_profile).join(".openclaw").join("agents").join("main").join("agent");
    std::fs::create_dir_all(&agent_dir)?;
    let file = agent_dir.join("auth-profiles.json");
    let now = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| AppError::Message(e.to_string()))?
            .as_secs()
    );

    let resolved_provider = resolve_provider_slug(&config.provider, &config.model);
    let mut providers: Vec<String> = provider_auth_profile_ids(&resolved_provider).iter().map(|s| s.to_string()).collect();
    if providers.is_empty() {
        providers.push(resolved_provider);
    }

    let mut provider_profiles = serde_json::Map::new();
    for provider in providers {
        let profile = serde_json::json!({
            "id": format!("portable-{}", provider),
            "provider": provider,
            "authMethod": "apiKey",
            "credentials": {
                "apiKey": config.api_key,
                "baseUrl": config.base_url
            },
            "createdAt": now,
            "updatedAt": now,
            "meta": {
                "source": "openclaw-portable"
            }
        });
        provider_profiles.insert(provider, serde_json::Value::Array(vec![profile]));
    }

    let data = serde_json::json!({
        "currentVersion": 1,
        "versions": [{
            "version": 1,
            "providerProfiles": provider_profiles,
            "globalProfiles": []
        }]
    });
    std::fs::write(file, serde_json::to_vec_pretty(&data).map_err(|e| AppError::Message(e.to_string()))?)?;
    Ok(())
}

fn canonical_provider_slug(provider: &str) -> String {
    match provider.to_ascii_lowercase().as_str() {
        "openai" => "openai".to_string(),
        "anthropic" => "anthropic".to_string(),
        "google" | "gemini" => "google".to_string(),
        "xai" | "grok" => "xai".to_string(),
        "zai" | "glm" | "zhipuai" | "bigmodel" => "zai".to_string(),
        "kimi" | "moonshot" => "kimi".to_string(),
        "deepseek" => "deepseek".to_string(),
        "minimax" => "minimax".to_string(),
        other => other.to_string(),
    }
}

fn infer_provider_slug_from_model(model: &str) -> Option<&'static str> {
    let lower = model.to_ascii_lowercase();
    if let Some((prefix, _)) = lower.split_once('/') {
        return Some(match prefix {
            "openai" => "openai",
            "anthropic" => "anthropic",
            "google" | "gemini" => "google",
            "xai" | "grok" => "xai",
            "zai" | "glm" | "zhipuai" | "bigmodel" => "zai",
            "kimi" | "moonshot" => "kimi",
            "deepseek" => "deepseek",
            "minimax" => "minimax",
            _ => return None,
        });
    }
    if lower.starts_with("gpt-") {
        return Some("openai");
    }
    if lower.starts_with("claude-") {
        return Some("anthropic");
    }
    if lower.starts_with("gemini-") {
        return Some("google");
    }
    if lower.starts_with("grok-") {
        return Some("xai");
    }
    if lower.starts_with("glm-") {
        return Some("zai");
    }
    if lower.starts_with("kimi-") || lower.starts_with("moonshot-") {
        return Some("kimi");
    }
    if lower.starts_with("deepseek-") {
        return Some("deepseek");
    }
    if lower.starts_with("minimax-") {
        return Some("minimax");
    }
    None
}

fn resolve_provider_slug(provider: &str, model: &str) -> String {
    if let Some(inferred) = infer_provider_slug_from_model(model) {
        return inferred.to_string();
    }
    canonical_provider_slug(provider)
}

fn resolve_model_id(provider: &str, model: &str) -> String {
    let raw = model.trim();
    if raw.contains('/') {
        return raw.to_string();
    }
    format!("{}/{}", resolve_provider_slug(provider, model), raw)
}

fn run_powershell_stream(
    app: &tauri::AppHandle,
    engine: &DeployEngine,
    step_id: &str,
    script: &str,
    tools_bin: &Path,
    extra_bin: &Path,
    timeout: Duration,
) -> AppResult<()> {
    let mut cmd = Command::new("powershell.exe");
    apply_no_window(&mut cmd);
    cmd.arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .env(
            "PATH",
            format!(
                "{};{};{}",
                tools_bin.display(),
                extra_bin.display(),
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| AppError::Message(e.to_string()))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (tx, rx) = mpsc::channel::<String>();

    if let Some(out) = stdout {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines().flatten() {
                let _ = tx.send(line);
            }
        });
    }
    if let Some(err) = stderr {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().flatten() {
                let _ = tx.send(line);
            }
        });
    }

    let start = std::time::Instant::now();
    loop {
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Message(format!("{step_id} 安装超时")));
        }

        while let Ok(line) = rx.try_recv() {
            append_output(app, engine, &line);
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                while let Ok(line) = rx.try_recv() {
                    append_output(app, engine, &line);
                }
                if status.success() {
                    return Ok(());
                }
                return Err(AppError::Message(format!("{step_id} 安装失败")));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(80)),
            Err(e) => return Err(AppError::Message(e.to_string())),
        }
    }
}
