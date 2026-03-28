const http = require("http");
const { createHash } = require("crypto");

const host = process.env.LICENSE_SERVER_HOST || "0.0.0.0";
const port = Number(process.env.LICENSE_SERVER_PORT || 8099);
const adminToken = process.env.LICENSE_ADMIN_TOKEN || "";
const salt = process.env.LICENSE_SALT || "OPENCLAW-SECRET-SALT";

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function sendHtml(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(html));
  res.end(html);
}

function isValidFingerprint(fingerprint) {
  return /^CLAW-[0-9A-F]{4}-[0-9A-F]{4}$/.test(fingerprint);
}

function buildLicenseKey(fingerprint) {
  return createHash("sha256")
    .update(`${fingerprint}-${salt}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/admin")) {
    const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenClaw 授权码后台</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; background: #f8fafc; color: #0f172a; }
    .wrap { max-width: 760px; margin: 40px auto; padding: 0 16px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(15,23,42,0.08); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0 0 18px; color: #475569; }
    label { display: block; margin: 14px 0 8px; font-size: 14px; color: #334155; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 10px; padding: 11px 12px; font-size: 14px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: end; margin-top: 14px; }
    button { background: #ef4444; color: #fff; border: 0; border-radius: 10px; padding: 11px 18px; font-size: 14px; cursor: pointer; }
    button:disabled { opacity: .6; cursor: not-allowed; }
    .result { margin-top: 18px; background: #0f172a; color: #f8fafc; border-radius: 12px; padding: 14px; white-space: pre-wrap; font-family: ui-monospace,Consolas,monospace; min-height: 84px; }
    .tips { margin-top: 12px; color: #64748b; font-size: 13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>授权码生成后台</h1>
      <p>输入设备指纹后生成授权码，可直接发给客户。</p>
      <label>设备指纹</label>
      <input id="fingerprint" placeholder="CLAW-1A2B-3C4D" />
      <label>管理员 Token（可选）</label>
      <input id="token" placeholder="若服务端设置了 LICENSE_ADMIN_TOKEN，这里要填写" />
      <div class="row">
        <div></div>
        <button id="genBtn">生成授权码</button>
      </div>
      <div class="result" id="result">等待生成...</div>
      <div class="tips">接口地址：POST /api/license/generate</div>
    </div>
  </div>
  <script>
    const btn = document.getElementById("genBtn");
    const fp = document.getElementById("fingerprint");
    const token = document.getElementById("token");
    const out = document.getElementById("result");
    btn.addEventListener("click", async () => {
      const fingerprint = fp.value.trim().toUpperCase();
      if (!fingerprint) {
        out.textContent = "请先输入设备指纹";
        return;
      }
      btn.disabled = true;
      out.textContent = "正在生成...";
      try {
        const headers = { "Content-Type": "application/json" };
        if (token.value.trim()) headers["x-admin-token"] = token.value.trim();
        const res = await fetch("/api/license/generate", {
          method: "POST",
          headers,
          body: JSON.stringify({ fingerprint })
        });
        const data = await res.json();
        if (!res.ok) {
          out.textContent = "生成失败\\n" + JSON.stringify(data, null, 2);
        } else {
          out.textContent = JSON.stringify(data, null, 2);
        }
      } catch (e) {
        out.textContent = "请求异常\\n" + String(e);
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
    return sendHtml(res, 200, page);
  }

  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { status: "ok", now: new Date().toISOString() });
  }

  if (req.method === "POST" && req.url === "/api/license/generate") {
    if (adminToken) {
      const token = req.headers["x-admin-token"] || "";
      if (token !== adminToken) {
        return sendJson(res, 401, { message: "invalid admin token" });
      }
    }

    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 64) {
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        const fingerprint = String(body.fingerprint || "").trim().toUpperCase();
        if (!isValidFingerprint(fingerprint)) {
          return sendJson(res, 400, { message: "fingerprint format invalid, expected CLAW-XXXX-XXXX" });
        }
        const licenseKey = buildLicenseKey(fingerprint);
        return sendJson(res, 200, {
          fingerprint,
          licenseKey,
          issuedAt: new Date().toISOString()
        });
      } catch {
        return sendJson(res, 400, { message: "invalid json body" });
      }
    });
    return;
  }

  return sendJson(res, 404, { message: "not found" });
});

server.listen(port, host, () => {
  console.log(`license server listening on http://${host}:${port}`);
});
