# 卡密生成后台

根据设备指纹返回授权码。

## 启动

```powershell
cd c:\Users\Administrator\Desktop\openclaw-usb-portable
npm run license:dev
```

默认地址：

- `http://127.0.0.1:8099`

## 可选环境变量

- `LICENSE_SERVER_HOST`：默认 `0.0.0.0`
- `LICENSE_SERVER_PORT`：默认 `8099`
- `LICENSE_ADMIN_TOKEN`：设置后，调用生成接口必须带 `x-admin-token`
- `LICENSE_SALT`：授权码盐值，默认 `OPENCLAW-SECRET-SALT`

## 接口

- `GET /health`
- `POST /api/license/generate`

请求体：

```json
{
  "fingerprint": "CLAW-1A2B-3C4D"
}
```

返回：

```json
{
  "fingerprint": "CLAW-1A2B-3C4D",
  "licenseKey": "A1B2C3D4E5F6A7B8",
  "issuedAt": "2026-03-27T00:00:00.000Z"
}
```
