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

export interface LicenseStatus {
  mode: string;
  state: string;
  message: string;
}
