export type RuntimeStatus = "uninitialized" | "ready" | "running" | "failed";

export interface AppConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  agentScenario: string;
  agentSystemPrompt: string;
  port: number;
  workspaceDir: string;
  dataDir: string;
  logDir: string;
  licenseMode: string;
  bindHost: string;
  licenseKey: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuEncryptKey: string;
  feishuVerificationToken: string;
  wechatEnabled: boolean;
  wechatMode: string;
  wechatDmPolicy: string;
  wechatPairingMessage: string;
  wechatGroupPolicy: string;
  wechatAllowGroups: string;
  wechatTriggerKeyword: string;
}

export interface AppState {
  baseDir: string;
  runtimeDir: string;
  openclawDir: string;
  workspaceDir: string;
  configPath: string;
  logDir: string;
  appVersion: string;
  status: RuntimeStatus;
  statusMessage: string;
  payloadDetected: boolean;
  controlPageUrl: string;
  deviceFingerprint: string;
  isAuthorized: boolean;
  config: AppConfig;
}

export interface LogBundle {
  app: string;
  stdout: string;
  stderr: string;
}

export interface EnvItem {
  id: string;
  name: string;
  required: boolean;
  installed: boolean;
  version: string;
  detail: string;
}

export interface DeployEvent {
  stepId: string;
  status: string;
  message: string;
  progress: number;
}

export interface DeploySnapshot {
  running: boolean;
  lastEvent: DeployEvent | null;
  output: string;
}

export interface GatewayStatus {
  running: boolean;
  message: string;
}

export interface GatewayLogs {
  stdout: string;
  stderr: string;
}

export interface LicenseStatus {
  mode: string;
  state: string;
  message: string;
}
