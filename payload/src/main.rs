#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::{
    env,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::Arc,
    thread,
};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProfile {
    scenario: Option<String>,
    system_prompt: Option<String>,
    provider: Option<String>,
    model: Option<String>,
}

fn env_or(name: &str, fallback: &str) -> String {
    env::var(name).ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| fallback.to_string())
}

fn read_agent_profile(path: &PathBuf) -> AgentProfile {
    let Ok(content) = std::fs::read_to_string(path) else {
        return AgentProfile::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn build_html(provider: &str, model: &str, agent_profile_path: &str, profile: &AgentProfile) -> String {
    let scenario = profile.scenario.clone().unwrap_or_default();
    let system_prompt = escape_html(profile.system_prompt.as_deref().unwrap_or_default());
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenClaw 控制台</title>
  <style>
    body {{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 0; background: #ffffff; color: #0f172a; }}
    .wrap {{ max-width: 980px; margin: 0 auto; padding: 32px 20px; }}
    .card {{ border: 1px solid #e5e7eb; border-radius: 16px; padding: 20px; background: #fff; box-shadow: 0 12px 24px rgba(15,23,42,0.06); }}
    .title {{ display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }}
    .badge {{ display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 999px; background: rgba(16, 185, 129, 0.08); color: #059669; border: 1px solid rgba(16, 185, 129, 0.25); font-weight: 700; font-size: 12px; }}
    pre {{ white-space: pre-wrap; background: #0b1220; color: rgba(255,255,255,0.88); padding: 14px; border-radius: 12px; overflow: auto; }}
    .kv {{ display: grid; grid-template-columns: 140px 1fr; gap: 10px 16px; margin: 16px 0; }}
    .k {{ color: #64748b; }}
    .v {{ font-weight: 600; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">
      <div class="badge">内置载荷</div>
      <h1 style="margin:0; font-size: 18px;">OpenClaw 控制台</h1>
    </div>
    <div class="card">
      <div class="kv">
        <div class="k">Provider</div><div class="v">{provider}</div>
        <div class="k">Model</div><div class="v">{model}</div>
        <div class="k">Agent 场景</div><div class="v">{scenario}</div>
      </div>
      <div class="k" style="margin: 14px 0 8px;">Agent System Prompt</div>
      <pre>{system_prompt}</pre>
      <div class="k" style="margin-top: 14px;">Agent Profile 路径</div>
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; font-size: 12px; color: #475569; margin-top: 6px;">
        {agent_profile_path}
      </div>
    </div>
  </div>
</body>
</html>"#
    )
}

fn write_response(mut stream: TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn handle_connection(stream: TcpStream, html: Arc<Vec<u8>>) {
    let mut stream = stream;
    let mut buf = [0u8; 4096];
    let Ok(n) = stream.read(&mut buf) else {
        return;
    };
    if n == 0 {
        return;
    }
    let req = String::from_utf8_lossy(&buf[..n]);
    let mut parts = req.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/");
    if method != "GET" {
        write_response(stream, "405 Method Not Allowed", "text/plain; charset=utf-8", b"Method Not Allowed");
        return;
    }
    if path == "/" || path.starts_with("/?") {
        write_response(stream, "200 OK", "text/html; charset=utf-8", &html);
        return;
    }
    write_response(stream, "404 Not Found", "text/plain; charset=utf-8", b"Not Found");
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host = env_or("OPENCLAW_BIND_HOST", "127.0.0.1");
    let port = env_or("OPENCLAW_PORT", "3847");
    let provider = env_or("OPENCLAW_PROVIDER", "DeepSeek");
    let model = env_or("OPENCLAW_MODEL", "deepseek-chat");
    let agent_profile_path = env_or("OPENCLAW_AGENT_PROFILE", "runtime\\config\\agent-profile.json");

    let profile_path = PathBuf::from(&agent_profile_path);
    let profile = read_agent_profile(&profile_path);
    let html = build_html(&provider, &model, &agent_profile_path, &profile);
    let html_bytes = Arc::new(html.into_bytes());

    eprintln!(
        "[OpenClaw Payload] starting\n[配置] provider={}\n[配置] model={}\n[服务] control: http://{}:{}\n",
        provider, model, host, port
    );

    let listener = TcpListener::bind(format!("{host}:{port}"))?;
    for conn in listener.incoming() {
        let Ok(stream) = conn else {
            continue;
        };
        let html = html_bytes.clone();
        thread::spawn(move || handle_connection(stream, html));
    }

    Ok(())
}
