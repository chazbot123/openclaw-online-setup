const fs = require("fs");
const http = require("http");
const path = require("path");

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const host = env("OPENCLAW_BIND_HOST", "127.0.0.1");
const port = Number(env("OPENCLAW_PORT", "3847"));
const provider = env("OPENCLAW_PROVIDER", "DeepSeek");
const model = env("OPENCLAW_MODEL", "deepseek-chat");
const agentProfilePath = env("OPENCLAW_AGENT_PROFILE", path.join(__dirname, "..", "config", "agent-profile.json"));
const agentProfile = readJson(agentProfilePath) || {};

const banner = [
  "[Lobster Mock Payload] 启动成功（测试载荷）",
  `[配置] provider=${provider}`,
  `[配置] model=${model}`,
  `[Agent] scenario=${agentProfile.scenario || ""}`,
  `[Agent] promptFile=${agentProfilePath}`,
  "",
].join("\n");

process.stdout.write(banner);

const server = http.createServer((req, res) => {
  const html = `<!doctype html>
  <html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenClaw 控制台（测试载荷）</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 0; background: #ffffff; color: #0f172a; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 32px 20px; }
      .card { border: 1px solid #e5e7eb; border-radius: 16px; padding: 20px; background: #fff; box-shadow: 0 12px 24px rgba(15,23,42,0.06); }
      .title { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
      .badge { display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 999px; background: rgba(239, 68, 68, 0.08); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.25); font-weight: 700; font-size: 12px; }
      pre { white-space: pre-wrap; background: #0b1220; color: rgba(255,255,255,0.88); padding: 14px; border-radius: 12px; overflow: auto; }
      .kv { display: grid; grid-template-columns: 140px 1fr; gap: 10px 16px; margin: 16px 0; }
      .k { color: #64748b; }
      .v { font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="title">
        <div class="badge">测试载荷</div>
        <h1 style="margin:0; font-size: 18px;">OpenClaw 控制台（Mock Lobster）</h1>
      </div>
      <div class="card">
        <div class="kv">
          <div class="k">Provider</div><div class="v">${provider}</div>
          <div class="k">Model</div><div class="v">${model}</div>
          <div class="k">Agent 场景</div><div class="v">${agentProfile.scenario || ""}</div>
        </div>
        <div class="k" style="margin: 14px 0 8px;">Agent System Prompt</div>
        <pre>${(agentProfile.systemPrompt || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</pre>
        <div class="k" style="margin-top: 14px;">路径</div>
        <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; font-size: 12px; color: #475569; margin-top: 6px;">
          ${agentProfilePath}
        </div>
      </div>
    </div>
  </body>
  </html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});

server.listen(port, host, () => {
  process.stdout.write(`[服务] 控制台地址: http://${host}:${port}\n`);
});

function shutdown() {
  process.stdout.write("[系统] 收到退出信号，正在停止...\n");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
