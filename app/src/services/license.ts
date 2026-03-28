import type { LicenseStatus } from "../types";

export interface LicenseProvider {
  getStatus(): Promise<LicenseStatus>;
  activate(input: string): Promise<LicenseStatus>;
}

export class MockLicenseService implements LicenseProvider {
  async getStatus(): Promise<LicenseStatus> {
    return {
      mode: "mock",
      state: "local-test",
      message: "授权模块预留，当前为本地测试模式"
    };
  }

  async activate(_: string): Promise<LicenseStatus> {
    return {
      mode: "mock",
      state: "accepted",
      message: "Mock 激活成功，未接入真实卡密平台"
    };
  }
}
