import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, AppState, DeploySnapshot, EnvItem, GatewayLogs, GatewayStatus, LogBundle } from "./types";

const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;

async function buildMockLicenseKey(fingerprint: string): Promise<string> {
  const normalized = fingerprint.trim().toUpperCase();
  const raw = `${normalized}-OPENCLAW-SECRET-SALT`;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return "9477C307A2A39F8D";
  }
  const buffer = await subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const bytes = Array.from(new Uint8Array(buffer)).slice(0, 8);
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

const mockConfig: AppConfig = {
  provider: "DeepSeek",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-mock-key-for-preview",
  model: "deepseek-chat",
  agentScenario: "ecommerce",
  agentSystemPrompt: "你是龙虾智能体（OpenClaw Agent）。专注跨境电商场景，输出可落地的行动方案与可执行清单。",
  workspaceDir: "runtime/workspace",
  dataDir: "runtime/data",
  logDir: "runtime/logs",
  licenseMode: "mock",
  licenseKey: "",
  feishuAppId: "",
  feishuAppSecret: "",
  feishuEncryptKey: "",
  feishuVerificationToken: "",
  wechatEnabled: false,
  wechatMode: "personal",
  wechatDmPolicy: "pairing",
  wechatPairingMessage: "请发送配对码以激活 AI 助手",
  wechatGroupPolicy: "allowlist",
  wechatAllowGroups: "",
  wechatTriggerKeyword: "@AI",
  bindHost: "127.0.0.1",
  port: 8080
};

let mockState: AppState = {
  baseDir: "C:\\Mock\\OpenClaw",
  runtimeDir: "C:\\Mock\\OpenClaw\\runtime",
  openclawDir: "C:\\Mock\\OpenClaw\\runtime\\openclaw",
  workspaceDir: "C:\\Mock\\OpenClaw\\runtime\\workspace",
  configPath: "C:\\Mock\\OpenClaw\\runtime\\config\\app-config.json",
  logDir: "C:\\Mock\\OpenClaw\\runtime\\logs",
  appVersion: "0.1.0",
  status: "ready",
  statusMessage: "运行载荷已检测，可执行启动",
  payloadDetected: true,
  controlPageUrl: "http://127.0.0.1:8080",
  config: mockConfig,
  deviceFingerprint: "CLAW-1A2B-3C4D",
  isAuthorized: false,
};

let mockLogs: LogBundle = {
  app: "[Mock] Application initialized.",
  stdout: "",
  stderr: ""
};

export const api = {
  getAppState: async () => {
    if (isTauri) return invoke<AppState>("get_app_state");
    return mockState;
  },
  initializeRuntime: async () => {
    if (isTauri) return invoke<AppState>("initialize_runtime");
    return mockState;
  },
  saveAppConfig: async (config: AppConfig) => {
    if (isTauri) return invoke<AppState>("save_app_config", { config });
    mockState.config = config;
    const expected = await buildMockLicenseKey(mockState.deviceFingerprint);
    mockState.isAuthorized = config.licenseKey.trim().toUpperCase() === expected;
    return mockState;
  },
  startOpenClaw: async () => {
    if (isTauri) return invoke<AppState>("start_openclaw");
    
    mockLogs.stdout = "[系统] 正在准备部署环境...\n";
    await new Promise(r => setTimeout(r, 600));
    mockLogs.stdout += "[系统] 验证授权码通过\n";
    await new Promise(r => setTimeout(r, 600));
    mockLogs.stdout += `[配置] 正在拉取 ${mockState.config.provider} 模型配置...\n`;
    await new Promise(r => setTimeout(r, 800));
    mockLogs.stdout += "[配置] 注入飞书 API 环境变量...\n";
    await new Promise(r => setTimeout(r, 800));
    mockLogs.stdout += "[服务] 启动 OpenClaw 核心进程...\n";
    await new Promise(r => setTimeout(r, 1000));
    
    mockState.status = "running";
    mockState.statusMessage = "OpenClaw 进程正在运行";
    mockLogs.stdout += `\n[成功] OpenClaw 服务已成功启动！\n[成功] 监听地址: ${mockState.config.bindHost}:${mockState.config.port}\n`;
    return mockState;
  },
  stopOpenClaw: async () => {
    if (isTauri) return invoke<AppState>("stop_openclaw");
    mockState.status = "ready";
    mockState.statusMessage = "运行载荷已检测，可执行启动";
    mockLogs.stdout += "\n[Mock] Stopping OpenClaw...";
    return mockState;
  },
  readLogs: async () => {
    if (isTauri) return invoke<LogBundle>("read_logs");
    return mockLogs;
  },
  openLogsDir: async () => {
    if (isTauri) return invoke<void>("open_logs_dir");
    console.log("[Mock] Opening logs dir");
  },
  openControlPage: async () => {
    if (isTauri) return invoke<void>("open_control_page");
    console.log("[Mock] Opening control page");
  },
  checkUpdate: async () => {
    if (isTauri) return invoke<string>("check_update");
    return `当前版本 ${mockState.appVersion}（预览模式不启用自动更新）`;
  },
  openInstallDir: async () => {
    if (isTauri) return invoke<void>("open_install_dir");
    console.log("[Mock] Opening install dir");
  },
  getEnvStatus: async () => {
    if (isTauri) return invoke<EnvItem[]>("get_env_status");
    return [
      { id: "node", name: "Node.js", required: true, installed: true, version: "v24.14.0", detail: "系统安装" },
      { id: "npm", name: "npm", required: true, installed: true, version: "11.9.0", detail: "系统安装" },
      { id: "git", name: "Git（可选）", required: false, installed: true, version: "git version 2.53.0.windows.2", detail: "系统安装" },
      { id: "openclaw", name: "OpenClaw", required: true, installed: false, version: "", detail: "未安装" }
    ];
  },
  startDeploy: async () => {
    if (isTauri) return invoke<void>("start_deploy");
    await new Promise(r => setTimeout(r, 800));
  },
  getDeploySnapshot: async () => {
    if (isTauri) return invoke<DeploySnapshot>("get_deploy_snapshot");
    return { running: false, lastEvent: null, output: "" };
  },
  openOpenClawDashboard: async () => {
    if (isTauri) return invoke<void>("open_openclaw_dashboard");
    console.log("[Mock] Opening OpenClaw dashboard");
  },
  wechatStartLogin: async () => {
    if (isTauri) return invoke<string>("wechat_start_login");
    return "已打开微信扫码终端，请在弹出窗口中扫描二维码";
  },
  gatewayStart: async () => {
    if (isTauri) return invoke<string>("gateway_start");
    return "OK";
  },
  gatewayStop: async () => {
    if (isTauri) return invoke<string>("gateway_stop");
    return "OK";
  },
  getGatewayStatus: async () => {
    if (isTauri) return invoke<GatewayStatus>("get_gateway_status");
    return { running: false, message: "未运行" };
  },
  readGatewayLogs: async () => {
    if (isTauri) return invoke<GatewayLogs>("read_gateway_logs");
    return { stdout: "", stderr: "" };
  },
};
