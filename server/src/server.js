const express = require("express");
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
require("dotenv").config({ path: join(__dirname, "..", ".env") });
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { createMcpExpressApp } = require("@modelcontextprotocol/sdk/server/express.js");
const { mcpAuthRouter } = require("@modelcontextprotocol/sdk/server/auth/router.js");
const { requireBearerAuth } = require("@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js");
const { InvalidTokenError } = require("@modelcontextprotocol/sdk/server/auth/errors.js");
const { LicenseError, LicenseService, hashSecret } = require("./license-service");

const port = Number(process.env.PORT || 3110);
const host = process.env.HOST || "0.0.0.0";
const publicBaseUrl = new URL(process.env.PUBLIC_BASE_URL || `https://guoxue.073955.com`);
const adminApiKey = process.env.ADMIN_API_KEY || "replace-this-before-deploying";
const serviceRoot = resolve(__dirname, "..");
const dataDir = resolve(process.env.DATA_DIR || join(serviceRoot, "data"));
const workflowDir = resolve(process.env.WORKFLOW_DIR || join(serviceRoot, "workflows"));
const licenseService = new LicenseService(join(dataDir, "licenses.sqlite"));

const workflowFiles = {
  guoxueChuanyueMain: join(workflowDir, "guoxue-chuanyue-main.md"),
  guoxueChuanyueExamples: join(workflowDir, "guoxue-chuanyue-examples.md"),
};

function deviceIdForOAuthClient(clientId) {
  return `oauth-client:${hashSecret(clientId)}`;
}

function shortHash(value) {
  return hashSecret(value).slice(0, 12);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left || "");
  const rightBuffer = Buffer.from(right || "");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fa;font:14px system-ui,sans-serif;color:#263238}
main{max-width:800px;margin:40px auto;padding:0 20px}.card{background:#fff;border:1px solid #e0e4e8;border-radius:8px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.05)}
h1{font-size:24px;margin:0 0 8px;color:#155eef}p{line-height:1.6;color:#5f6b73}
label{display:block;margin:16px 0 6px;font-weight:600}input{display:block;width:100%;padding:10px;border:1px solid #c8d0d5;border-radius:5px;font:inherit}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:5px;background:#155eef;color:#fff;font:inherit;cursor:pointer}
.notice{padding:12px;border:1px solid #ffd591;border-radius:5px;background:#fff7e6;color:#8a4b08;margin-bottom:16px}
.success{border-color:#8dcf9d;background:#effbf1;color:#1e6c30}
.error{border-color:#e5a5a0;background:#fff1f0;color:#a61d24}
code{font-family:monospace;background:#f5f7fa;padding:2px 6px;border-radius:3px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:12px 8px;text-align:left;border-bottom:1px solid #e5e9ef}
th{color:#667085;font-weight:600}
small{color:#667085;line-height:1.5}
</style></head><body><main>${body}</main></body></html>`;
}

// OAuth client management
const oauthClients = new Map();

function getOrCreateClient(customerId, deviceId) {
  const clientKey = `${customerId}:${deviceId}`;
  if (!oauthClients.has(clientKey)) {
    const clientId = randomBytes(16).toString("hex");
    const clientSecret = randomBytes(32).toString("hex");
    oauthClients.set(clientKey, { clientId, clientSecret, customerId, deviceId });
  }
  return oauthClients.get(clientKey);
}

// MCP Server setup
const mcpServer = new McpServer({
  name: "guoxue-chuanyue-service",
  version: "1.1.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

mcpServer.registerTool("get_guoxue_chuanyue_main_workflow", {
  description: "获取育儿国风穿越核心规则文件",
  inputSchema: { type: "object", properties: {} },
}, async () => ({
  content: [{
    type: "text",
    text: readFileSync(workflowFiles.guoxueChuanyueMain, "utf8"),
  }],
}));

mcpServer.registerTool("get_guoxue_chuanyue_examples_workflow", {
  description: "获取育儿国风穿越范例库",
  inputSchema: { type: "object", properties: {} },
}, async () => ({
  content: [{
    type: "text",
    text: readFileSync(workflowFiles.guoxueChuanyueExamples, "utf8"),
  }],
}));

// Express app
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "guoxue-chuanyue", version: "1.1.0" });
});

// Admin API
function requireAdminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !safeEqual(auth, `Bearer ${adminApiKey}`)) {
    return res.status(401).json({ error: "未授权" });
  }
  next();
}

app.post("/admin/codes/generate", requireAdminAuth, (req, res) => {
  try {
    const count = Math.min(100, Math.max(1, Number(req.body.count) || 1));
    const days = Number(req.body.expiresInDays) || null;
    const codes = licenseService.generateCodes(count, days);
    res.json({ codes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/admin/codes", requireAdminAuth, (req, res) => {
  try {
    const codes = licenseService.listActivationCodes();
    res.json({ codes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/admin/codes/:id/revoke", requireAdminAuth, (req, res) => {
  try {
    licenseService.revokeCode(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Redeem code page
app.get("/redeem", (req, res) => {
  const message = req.query.error || "";
  res.send(htmlPage("激活授权", `
    <div class="card">
      <h1>曾美团队·育儿国风穿越</h1>
      <p>首次使用请输入手机号和授权码激活</p>
      ${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ""}
      <form method="post" action="/redeem">
        <label>手机号<input name="phone" type="tel" required autocomplete="tel"></label>
        <label>授权码<input name="code" required autocomplete="off" placeholder="GX-XXXX-XXXX-XXXX-XXXX-XXXX"></label>
        <button type="submit">激活</button>
      </form>
    </div>
  `));
});

app.post("/redeem", async (req, res) => {
  try {
    const phone = String(req.body.phone || "").trim();
    const code = String(req.body.code || "").trim();
    const deviceId = req.headers["user-agent"] || "unknown";
    const deviceLabel = `浏览器-${new Date().toISOString().split("T")[0]}`;

    const result = licenseService.redeemCode(phone, code, deviceId, deviceLabel);
    const client = getOrCreateClient(result.customer.id, deviceId);

    res.send(htmlPage("激活成功", `
      <div class="card">
        <h1>激活成功！</h1>
        <div class="notice success">授权已绑定到当前设备</div>
        <p><strong>Client ID:</strong> <code>${client.clientId}</code></p>
        <p><strong>Client Secret:</strong> <code>${client.clientSecret}</code></p>
        <p style="margin-top:20px">请复制以上信息，配置到 Claude Desktop 的 MCP 服务器设置中。</p>
      </div>
    `));
  } catch (error) {
    if (error instanceof LicenseError) {
      return res.redirect(`/redeem?error=${encodeURIComponent(error.message)}`);
    }
    res.status(500).send(htmlPage("错误", `<div class="card"><h1>激活失败</h1><p>${escapeHtml(error.message)}</p></div>`));
  }
});

// OAuth + MCP
const authRouter = mcpAuthRouter({
  async lookupClient(clientId) {
    for (const client of oauthClients.values()) {
      if (client.clientId === clientId) return { clientId, clientSecret: client.clientSecret };
    }
    return null;
  },
  baseUrl: publicBaseUrl.toString(),
  issuer: publicBaseUrl.toString(),
});

app.use("/auth", authRouter);

const mcpTransport = new StreamableHTTPServerTransport("/mcp/v1", mcpServer);
const mcpApp = createMcpExpressApp(mcpTransport, {
  authenticator: requireBearerAuth(async (token) => {
    for (const client of oauthClients.values()) {
      if (token === `${client.clientId}:${client.clientSecret}`) {
        licenseService.verifyDevice(client.customerId, client.deviceId);
        return { sub: client.customerId };
      }
    }
    throw new InvalidTokenError("无效的访问令牌");
  }),
});

app.use("/mcp", mcpApp);

// Start server
app.listen(port, host, () => {
  console.log(`✅ 服务已启动: http://${host}:${port}`);
  console.log(`📍 公共地址: ${publicBaseUrl}`);
  console.log(`🔐 管理接口: ${publicBaseUrl}admin/codes`);
});
