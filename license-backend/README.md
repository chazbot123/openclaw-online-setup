# OpenClaw 卡密后台

该后台根据设备指纹生成授权码，算法与桌面端 `validate_license` 保持一致。

## 启动

```powershell
cd c:\Users\Administrator\Desktop\openclaw-usb-portable
npm run license:dev
```

默认监听：

- `http://0.0.0.0:8099`

可选环境变量：

- `LICENSE_SERVER_HOST`：监听地址
- `LICENSE_SERVER_PORT`：监听端口
- `LICENSE_ADMIN_TOKEN`：设置后调用生成接口必须带 `x-admin-token`

## 接口

### 健康检查

- `GET /health`

### 生成授权码

- `POST /api/license/generate`
- `Content-Type: application/json`
- Body:

```json
{
  "fingerprint": "CLAW-1A2B-3C4D"
}
```

返回：

```json
{
  "fingerprint": "CLAW-1A2B-3C4D",
  "licenseKey": "XXXXXXXX",
  "issuedAt": "2026-03-27T00:00:00Z"
}
```

## 调用示例

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8099/api/license/generate" `
  -ContentType "application/json" `
  -Body '{"fingerprint":"CLAW-1A2B-3C4D"}'
```
