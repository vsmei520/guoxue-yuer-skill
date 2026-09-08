const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const readline = require("readline");

const remoteMcpUrl = process.env.ZENGMEI_MCP_URL || "https://guoxue.073955.com/mcp";
const apiBaseUrl = remoteMcpUrl.replace(/\/mcp\/?$/, "");
const appData = process.env.APPDATA || process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
const stateDir = path.join(appData, "ZengmeiTeam");
const deviceFile = path.join(stateDir, "guoxue-device-id");
const authFile = path.join(stateDir, "guoxue-auth.dat");
let setupServer;
let setupUrl;

function ensureStateDirectory() {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
}

function localDeviceId() {
  ensureStateDirectory();
  if (fs.existsSync(deviceFile)) {
    const saved = fs.readFileSync(deviceFile, "utf8").trim();
    if (saved) return saved;
  }
  const created = `gx-${crypto.randomBytes(24).toString("hex")}`;
  fs.writeFileSync(deviceFile, created, { encoding: "utf8", mode: 0o600 });
  return created;
}

function protectForCurrentUser(value) {
  if (process.platform !== "win32") return Buffer.from(value, "utf8").toString("base64");
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$inputText = [Console]::In.ReadToEnd()",
    "$plain = [Convert]::FromBase64String($inputText)",
    "$cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($cipher))",
  ].join("; ");
  return childProcess.execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: Buffer.from(value, "utf8").toString("base64"),
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function unprotectForCurrentUser(value) {
  if (process.platform !== "win32") return Buffer.from(value, "base64").toString("utf8");
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$inputText = [Console]::In.ReadToEnd()",
    "$cipher = [Convert]::FromBase64String($inputText)",
    "$plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
  ].join("; ");
  return childProcess.execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: value,
    encoding: "utf8",
    windowsHide: true,
  });
}

function loadAuthData() {
  if (!fs.existsSync(authFile)) return null;
  try {
    return JSON.parse(unprotectForCurrentUser(fs.readFileSync(authFile, "utf8")));
  } catch {
    return null;
  }
}

function saveAuthData(data) {
  ensureStateDirectory();
  fs.writeFileSync(authFile, protectForCurrentUser(JSON.stringify(data)), { encoding: "utf8", mode: "600" });
}

function htmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function activatePage(message = "") {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>曾美团队·育儿国风穿越</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#263238;font:15px system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}main{width:min(520px,100%);padding:20px}.panel{background:#fff;border:1px solid #dfe4e8;border-radius:8px;padding:30px;box-shadow:0 8px 25px #00000012}h1{margin:0 0 10px;color:#155eef;font-size:24px}p{line-height:1.6;color:#5f6b73}label{display:block;margin:18px 0 6px;font-weight:600}input{display:block;width:100%;padding:11px;border:1px solid #c8d0d5;border-radius:5px;font:inherit}button{width:100%;margin-top:22px;padding:12px;border:0;border-radius:5px;background:#155eef;color:#fff;font:inherit;cursor:pointer}.notice{padding:11px;border:1px solid #ffd591;border-radius:5px;background:#fff7e6;color:#8a4b08}.message{padding:11px;border:1px solid #b7e1c1;border-radius:5px;background:#eaf7ee;color:#176b2c}.error{padding:11px;border:1px solid #ffccc7;border-radius:5px;background:#fff2f0;color:#a8071a}</style></head>
<body><main><section class="panel"><h1>曾美团队·育儿国风穿越</h1><p>首次使用请输入手机号和授权码，授权会绑定当前电脑。</p><div class="notice">授权信息只加密保存在本机，AI 由服务器统一提供。</div>${message ? `<p class="${message.startsWith("✅") ? "message" : "error"}">${message}</p>` : ""}<form method="post" action="/activate"><label for="phone">手机号</label><input id="phone" name="phone" type="tel" required autocomplete="tel"><label for="code">授权码</label><input id="code" name="code" required autocomplete="off"><button type="submit">激活使用</button></form></section></main></body></html>`;
}

function bodyText(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) {
        req.destroy();
        reject(new Error("请求过大"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function fetchJson(url, options = {}) {
  if (typeof fetch !== "function") throw new Error("客户端需要 Node.js 18 或更高版本");
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("服务器返回格式不正确");
  }
  return { response, data };
}

async function activate(phone, code) {
  const { response, data } = await fetchJson(`${apiBaseUrl}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code, deviceId: localDeviceId() }),
  });
  if (!response.ok || data?.error) throw new Error(data?.error || "激活失败");
  saveAuthData({
    deviceId: localDeviceId(),
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  });
}

async function refreshAuth(authData) {
  const { response, data } = await fetchJson(`${apiBaseUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: authData.refreshToken, deviceId: authData.deviceId }),
  });
  if (!response.ok || data?.error) throw new Error(data?.error || "授权已失效，请重新激活");
  const next = {
    ...authData,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  };
  saveAuthData(next);
  return next;
}

async function requestMcp(request, authData, canRefresh = true) {
  const headers = { "Content-Type": "application/json" };
  if (authData?.accessToken) {
    headers.Authorization = `Bearer ${authData.accessToken}`;
    headers["X-Device-ID"] = authData.deviceId;
  }
  const { response, data } = await fetchJson(remoteMcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  if (response.status === 401 && canRefresh && authData?.refreshToken) {
    const refreshed = await refreshAuth(authData);
    return requestMcp(request, refreshed, false);
  }
  return data;
}

async function requestAuthStatus(authData) {
  const headers = { Authorization: `Bearer ${authData.accessToken}`, "X-Device-ID": authData.deviceId };
  const { response, data } = await fetchJson(`${apiBaseUrl}/auth/status`, { headers });
  if (response.status === 401 && authData.refreshToken) {
    const refreshed = await refreshAuth(authData);
    return requestAuthStatus(refreshed);
  }
  if (!response.ok || data?.error) throw new Error(data?.error || "授权已失效，请重新激活");
  return data;
}

async function startSetupServer() {
  if (setupUrl) return setupUrl;
  setupServer = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(activatePage());
    }
    if (req.method === "POST" && req.url === "/activate") {
      try {
        const values = Object.fromEntries(new URLSearchParams(await bodyText(req)));
        const phone = String(values.phone || "").trim();
        const code = String(values.code || "").trim().toUpperCase();
        if (!phone || !code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          return res.end(activatePage("❌ 请填写手机号和授权码"));
        }
        await activate(phone, code);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(activatePage("✅ 激活成功！关闭此页面，回到客户端继续使用。"));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(activatePage(`❌ ${htmlEscape(error.message)}`));
      }
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => setupServer.listen(0, "127.0.0.1", resolve));
  setupUrl = `http://127.0.0.1:${setupServer.address().port}`;
  return setupUrl;
}

function result(id, text, isError = false) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result: { content: [{ type: "text", text }], isError } })}\n`);
}

async function forward(request) {
  if (request.method === "tools/list") {
    const response = await requestMcp(request, loadAuthData());
    if (response?.result?.tools) {
      response.result.tools.push(
        { name: "activate_license", description: "打开本机授权页面。用户只需填写手机号和授权码。", inputSchema: { type: "object", properties: {} } },
        { name: "auth_status", description: "检查当前电脑的授权状态。", inputSchema: { type: "object", properties: {} } },
      );
    }
    return process.stdout.write(`${JSON.stringify(response)}\n`);
  }

  if (request.method === "tools/call" && request.params?.name === "activate_license") {
    const url = await startSetupServer();
    return result(request.id, `请在本机浏览器打开：${url}\n\n填写手机号和授权码即可激活。`);
  }

  const authData = loadAuthData();
  if (request.method === "tools/call" && request.params?.name === "auth_status") {
    if (!authData) return result(request.id, "当前电脑尚未激活，请先调用 activate_license。", true);
    try {
      const status = await requestAuthStatus(authData);
      return result(request.id, `授权状态：${status.active ? "正常" : "已失效"}\n手机号：${status.phone}\n设备状态：${status.device.status}\n授权状态：${status.license.status}`);
    } catch (error) {
      return result(request.id, error.message, true);
    }
  }

  if (!authData) return result(request.id, "请先调用 activate_license 完成授权。", true);
  const response = await requestMcp(request, authData);
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  forward(request).catch((error) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32603, message: `插件本地服务异常：${error.message}` } })}\n`);
  });
});
