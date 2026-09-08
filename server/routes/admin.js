const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { generateCode, hash } = require("../utils/crypto");
const db = require("../config/database");

const router = express.Router();
const COOKIE_NAME = "guoxue_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function maskPhone(phone) {
  const value = String(phone || "");
  return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : "****";
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function sessionSignature(value) {
  return crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET || "").update(value).digest("base64url");
}

function createSessionCookie() {
  const value = `${Date.now()}.${crypto.randomBytes(18).toString("hex")}`;
  return `${value}.${sessionSignature(value)}`;
}

function isAdminSessionValid(req) {
  if (!process.env.ADMIN_SESSION_SECRET) return false;
  const value = parseCookies(req)[COOKIE_NAME] || "";
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [createdAt, nonce, signature] = parts;
  if (!/^\d+$/.test(createdAt) || !nonce || Date.now() - Number(createdAt) > SESSION_TTL_SECONDS * 1000) return false;
  const expected = sessionSignature(`${createdAt}.${nonce}`);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function requireAdmin(req, res, next) {
  if (isAdminSessionValid(req)) return next();
  if (req.accepts("html")) return res.redirect("/admin/login");
  return res.status(401).json({ error: "管理员未登录" });
}

function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#263238;font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1100px;margin:32px auto;padding:0 18px}.panel{background:#fff;border:1px solid #dfe4e8;border-radius:8px;padding:22px;margin-bottom:18px}h1{font-size:24px;margin:0 0 8px}h2{font-size:17px;margin:0 0 14px}p{color:#5f6b73}.row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}label{display:flex;flex-direction:column;gap:6px;font-weight:600}input{padding:9px 10px;border:1px solid #c8d0d5;border-radius:5px;font:inherit;min-width:150px}button{border:0;border-radius:5px;padding:10px 14px;background:#16803c;color:white;font:inherit;cursor:pointer}button.danger{background:#b42318}button.secondary{background:#5f6b73}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #edf0f2;vertical-align:middle}th{color:#5f6b73;font-weight:600}.muted{color:#78858d;font-size:12px}.code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#155eef}.notice{background:#fff7e6;border:1px solid #ffd591;padding:11px;border-radius:5px;color:#8a4b08}.success{background:#eaf7ee;border:1px solid #b7e1c1;padding:11px;border-radius:5px;color:#176b2c}.top{display:flex;justify-content:space-between;align-items:center;gap:16px}.inline{display:inline}.actions{display:flex;gap:6px;flex-wrap:wrap}a{color:#155eef;text-decoration:none}@media(max-width:700px){main{margin:12px auto}.panel{padding:15px;overflow:auto}table{min-width:760px}.top{align-items:flex-start;flex-direction:column}}
</style></head><body><main>${body}</main></body></html>`;
}

function loginPage(message = "") {
  return page("管理员登录", `<section class="panel" style="max-width:420px;margin:70px auto"><h1>授权管理</h1><p>登录后管理授权码和设备。</p>${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}<form method="post" action="/admin/login"><label>管理员密码<input name="password" type="password" required autofocus autocomplete="current-password"></label><button type="submit" style="margin-top:16px">登录</button></form></section>`);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "永久";
}

function statusText(value) {
  return ({ active: "正常", revoked: "已撤销", unbound: "已解绑" }[value] || value || "-");
}

function overviewPage(rows, message = "") {
  const tableRows = rows.map((row) => `<tr>
<td class="code">${escapeHtml(row.code_mask)}</td><td>${escapeHtml(statusText(row.status))}</td><td>${escapeHtml(maskPhone(row.phone))}</td><td>${escapeHtml(statusText(row.device_status))}</td><td>${escapeHtml(formatDate(row.expires_at))}</td><td>${escapeHtml(formatDate(row.last_used_at))}</td>
<td class="actions">${row.status === "active" ? `<form class="inline" method="post" action="/admin/codes/${encodeURIComponent(row.id)}/revoke"><button class="danger" type="submit">撤销授权码</button></form>` : ""}${row.device_id && row.device_status === "active" ? `<form class="inline" method="post" action="/admin/devices/${encodeURIComponent(row.device_id)}/unbind"><button class="secondary" type="submit">解绑设备</button></form>` : ""}</td>
</tr>`).join("");
  return page("授权管理", `<section class="panel"><div class="top"><div><h1>曾美团队·授权管理</h1><p>生成授权码，查看绑定状态，必要时解绑或撤销。</p></div><form method="post" action="/admin/logout"><button class="secondary" type="submit">退出登录</button></form></div></section>${message ? `<section class="panel success">${escapeHtml(message)}</section>` : ""}<section class="panel"><h2>生成授权码</h2><div class="notice" style="margin-bottom:14px">授权码只在生成后显示一次，请立即复制保存。服务器只保存哈希。</div><form method="post" action="/admin/codes/generate" class="row"><label>数量<input name="count" type="number" min="1" max="100" value="1"></label><label>有效期（天，可留空）<input name="days" type="number" min="1" max="3650" placeholder="永久"></label><button type="submit">生成</button></form></section><section class="panel"><h2>授权状态</h2><table><thead><tr><th>授权码</th><th>授权状态</th><th>手机号</th><th>设备状态</th><th>到期时间</th><th>最近使用</th><th>操作</th></tr></thead><tbody>${tableRows || "<tr><td colspan=7>暂无授权码</td></tr>"}</tbody></table></section>`);
}

router.get("/login", (req, res) => {
  if (isAdminSessionValid(req)) return res.redirect("/admin");
  res.type("html").send(loginPage());
});

router.post("/login", async (req, res) => {
  const password = String(req.body.password || "");
  const storedHash = String(process.env.ADMIN_PASSWORD_HASH || "");
  const valid = storedHash && password && await bcrypt.compare(password, storedHash).catch(() => false);
  if (!valid) return res.status(401).type("html").send(loginPage("密码错误或管理员尚未配置"));
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(createSessionCookie())}; Max-Age=${SESSION_TTL_SECONDS}; Path=/admin; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.redirect("/admin");
});

router.post("/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; Path=/admin; HttpOnly; SameSite=Lax`);
  res.redirect("/admin/login");
});

router.use(requireAdmin);

router.get("/", async (req, res) => {
  try {
    res.type("html").send(overviewPage(await db.listAdminOverview()));
  } catch (error) {
    console.error("读取管理数据失败:", error.message);
    res.status(500).type("html").send(page("错误", `<section class="panel"><h1>读取失败</h1><p>数据库暂时不可用。</p></section>`));
  }
});

router.post("/codes/generate", async (req, res) => {
  try {
    const count = Math.min(100, Math.max(1, Number.parseInt(req.body.count, 10) || 1));
    const days = Number.parseInt(req.body.days, 10);
    const expiresAt = Number.isInteger(days) && days > 0 ? new Date(Date.now() + days * 86400000) : null;
    const items = Array.from({ length: count }, () => {
      const code = generateCode();
      return { code, codeHash: hash(code), codeMask: `${code.slice(0, 4)}******${code.slice(-4)}`, expiresAt };
    });
    const created = await db.createRedemptionCodes(items);
    await db.addAuditLog({ action: "admin.codes.generate", targetType: "redemption_codes", details: { count }, ip: req.ip, userAgent: req.get("user-agent") });
    const codes = created.map((item) => escapeHtml(item.code)).join("<br>");
    res.type("html").send(page("授权码已生成", `<section class="panel"><h1>授权码已生成</h1><div class="success">请现在复制保存，离开此页面后不会再次显示完整授权码。</div><p class="code" style="line-height:2">${codes}</p><a href="/admin">返回授权管理</a></section>`));
  } catch (error) {
    console.error("生成授权码失败:", error.message);
    res.status(500).type("html").send(page("生成失败", `<section class="panel"><h1>生成失败</h1><p>请检查数据库连接后重试。</p><a href="/admin">返回</a></section>`));
  }
});

router.post("/codes/:id/revoke", async (req, res) => {
  await db.revokeCode(req.params.id);
  await db.addAuditLog({ action: "admin.code.revoke", targetType: "redemption_code", targetId: req.params.id, ip: req.ip, userAgent: req.get("user-agent") });
  res.redirect("/admin");
});

router.post("/devices/:id/unbind", async (req, res) => {
  await db.unbindDevice(req.params.id);
  await db.addAuditLog({ action: "admin.device.unbind", targetType: "device", targetId: req.params.id, ip: req.ip, userAgent: req.get("user-agent") });
  res.redirect("/admin");
});

module.exports = router;
