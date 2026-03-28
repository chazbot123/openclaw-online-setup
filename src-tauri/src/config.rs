use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::error::{AppError, AppResult};

pub const DEFAULT_CONFIG: &str = r#"{
  "provider": "DeepSeek",
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "",
  "model": "deepseek-chat",
  "agentScenario": "ecommerce",
  "agentSystemPrompt": "你是龙虾智能体（OpenClaw Agent）。专注跨境电商场景，输出可落地的行动方案与可执行清单。",
  "port": 3847,
  "workspaceDir": "runtime/workspace",
  "dataDir": "runtime/data",
  "logDir": "runtime/logs",
  "licenseMode": "mock",
  "bindHost": "127.0.0.1",
  "licenseKey": "",
  "feishuAppId": "",
  "feishuAppSecret": "",
  "feishuEncryptKey": "",
  "feishuVerificationToken": ""
}"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub agent_scenario: String,
    #[serde(default)]
    pub agent_system_prompt: String,
    pub port: u16,
    pub workspace_dir: String,
    pub data_dir: String,
    pub log_dir: String,
    pub license_mode: String,
    pub bind_host: String,
    #[serde(default)]
    pub license_key: String,
    #[serde(default)]
    pub feishu_app_id: String,
    #[serde(default)]
    pub feishu_app_secret: String,
    #[serde(default)]
    pub feishu_encrypt_key: String,
    #[serde(default)]
    pub feishu_verification_token: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        serde_json::from_str(DEFAULT_CONFIG).expect("valid default config")
    }
}

impl AppConfig {
    pub fn validate(&self) -> AppResult<()> {
        for path in [&self.workspace_dir, &self.data_dir, &self.log_dir] {
            if Path::new(path).is_absolute() {
                return Err(AppError::Config(
                    "所有目录配置必须为相对路径，不能使用绝对路径".into(),
                ));
            }
        }

        if self.bind_host != "127.0.0.1" {
            return Err(AppError::Config(
                "默认仅允许绑定 127.0.0.1，禁止改为 0.0.0.0 或其他地址".into(),
            ));
        }

        if self.port == 0 {
            return Err(AppError::Config("端口必须为 1-65535".into()));
        }

        Ok(())
    }

    pub fn load_or_create(path: &Path) -> AppResult<Self> {
        if path.exists() {
            let content = fs::read_to_string(path)?;
            let config: Self = serde_json::from_str(&content)?;
            config.validate()?;
            return Ok(config);
        }

        let config = Self::default();
        config.save(path)?;
        Ok(config)
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        self.validate()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        fs::write(path, content)?;
        Ok(())
    }

    pub fn workspace_path(&self, base_dir: &Path) -> PathBuf {
        base_dir.join(&self.workspace_dir)
    }

    pub fn data_path(&self, base_dir: &Path) -> PathBuf {
        base_dir.join(&self.data_dir)
    }

    pub fn log_path(&self, base_dir: &Path) -> PathBuf {
        base_dir.join(&self.log_dir)
    }
}
