# OpenClaw USB Portable

`openclaw-usb-portable` 是一个面向 Windows 的最小便携桌面壳，目标是把 OpenClaw 运行载荷封装成可直接复制到 U 盘的本地程序。当前版本只实现本地壳、配置保存、运行控制、日志查看和授权接口预留，不接入真实 API Key 服务端，也不接入任何卡密平台。

## 当前特性

- Tauri + React/TypeScript 最小桌面壳
- 运行目录全部基于程序根目录相对路径
- 首次引导页、首页、运行控制、API 配置、日志、设置、授权占位页
- 本地配置保存到 `runtime/config/app-config.json`
- 本地进程启动/停止与日志分流
- 支持在应用内打开本地控制页
- 不做在线更新、不申请管理员权限、不写系统服务

## 目录结构

```text
openclaw-usb-portable/
  app/
  src-tauri/
  runtime/
    openclaw/
    workspace/
    config/
    logs/
    data/
  scripts/
  docs/
```

## 本地开发

前置条件：

- Node.js 18+
- Rust stable
- Windows WebView2 Runtime

安装依赖：

```powershell
cd E:\openclaw-usb-portable
npm install
npm run app:install
```

开发启动：

```powershell
npm run dev
```

说明：

- 前端开发目录为 `app/`
- Tauri 后端位于 `src-tauri/`
- 程序会在启动时自动检查并创建 `runtime/` 下的目录和默认配置

## 构建 Windows portable 版本

```powershell
cd E:\openclaw-usb-portable
powershell -ExecutionPolicy Bypass -File .\build-portable.ps1
```

构建输出：

- `dist-portable\OpenClawPortable\`

该目录可直接复制到 U 盘。程序所有运行数据默认都保存在该目录内部的 `runtime/` 下。

## 构建 Windows 安装包（给客户安装）

本项目已支持生成 NSIS 安装包（`.exe` 安装程序），客户安装后以桌面软件方式使用，不是 Web 页面。

构建命令：

```powershell
cd E:\openclaw-usb-portable
npm install
npm run app:install
npm run build:installer
```

安装包输出目录（默认）：

- `src-tauri\target\release\bundle\nsis\`

常见文件名示例：

- `OpenClaw Deployer_0.1.0_x64-setup.exe`

交付给客户时，发送该安装包即可。客户安装后，通过开始菜单或桌面快捷方式启动本程序。

## 手动放入 OpenClaw 运行载荷

当前版本不会自动下载任何官方内容。请手动将 OpenClaw 运行文件放到：

- `runtime/openclaw/`

启动器会优先尝试以下文件名：

- `openclaw.exe`
- `OpenClaw.exe`
- `start.cmd`
- `start.bat`
- `launch.cmd`
- `launch.bat`

如果你的载荷入口名称不同，可自行调整 [src-tauri/src/runtime.rs](E:/openclaw-usb-portable/src-tauri/src/runtime.rs) 中的候选列表。

## 如何配置 API Key

在程序左侧进入“API配置”页面，填写：

- Provider 名称
- Base URL
- API Key
- Model

点击保存后，配置会写入：

- `runtime/config/app-config.json`

注意：

- API Key 只保存在本地文件，不写死在源码中
- 默认监听地址为 `127.0.0.1`
- 默认端口为 `3847`

## 如何接入真实卡密系统

当前仅保留扩展点，不包含真实对接。建议后续从以下位置扩展：

- 前端授权接口：[app/src/services/license.ts](E:/openclaw-usb-portable/app/src/services/license.ts)
- 后端配置结构：[src-tauri/src/config.rs](E:/openclaw-usb-portable/src-tauri/src/config.rs)
- 运行状态聚合：[src-tauri/src/runtime.rs](E:/openclaw-usb-portable/src-tauri/src/runtime.rs)

建议二期增加：

- `LicenseProvider` 真实实现
- 本地授权缓存与离线校验
- 启动前授权检查
- 更细粒度的日志与错误码映射

## 卡密后台（设备指纹 -> 授权码）

项目已内置一个独立后台服务：

- [license-backend/README.md](file:///c:/Users/Administrator/Desktop/openclaw-usb-portable/license-backend/README.md)

快速启动：

```powershell
cd c:\Users\Administrator\Desktop\openclaw-usb-portable
npm run license:dev
```
