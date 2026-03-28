请手动将 OpenClaw 运行载荷放入本目录。

当前启动器会优先尝试以下入口文件：
- openclaw.exe
- OpenClaw.exe
- start.cmd
- start.bat
- launch.cmd
- launch.bat

如果你的入口文件名称不同，请修改 src-tauri/src/runtime.rs 中的候选列表。
