# 当前实现说明

## 已真实实现

- Tauri + React/TypeScript 项目骨架
- 程序启动时自动创建 `runtime/` 目录和默认配置
- 本地配置读写：`runtime/config/app-config.json`
- 运行状态检测：未初始化 / 已就绪 / 运行中 / 失败
- OpenClaw 载荷存在性检查
- 基于相对路径的本地进程启动/停止
- stdout/stderr 日志写入 `runtime/logs/`
- 应用内打开本地控制页
- 日志页面读取程序日志与 OpenClaw 日志
- 授权模块接口预留与 Mock 服务
- Windows portable 构建脚本

## 当前仅为接口预留

- 真实 OpenClaw 协议适配
- 真实 API 调用联通性校验
- 真实卡密 / License 平台对接
- 首次引导完成状态持久化增强
- 自动识别多种 OpenClaw 启动参数模板
- 更丰富的错误恢复与健康检查

## 二期开工建议

1. 补充载荷元数据描述文件，例如 `runtime/openclaw/manifest.json`，避免只靠文件名猜入口。
2. 增加启动参数模板编辑器，把 `port`、`bindHost`、`configDir` 显式映射到具体命令行。
3. 为日志系统增加分页、过滤、自动刷新和导出。
4. 引入授权缓存、签名校验和离线宽限逻辑。
5. 增加打包后自检脚本，验证 portable 目录在不同盘符下运行。
