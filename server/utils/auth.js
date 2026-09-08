const crypto = require("crypto");
const db = require("../config/database");

function bearerToken(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function authenticate(req, res, next) {
  try {
    const token = bearerToken(req);
    const deviceId = String(req.headers["x-device-id"] || "");
    if (!token || !deviceId) {
      return res.status(401).json({ error: "未授权" });
    }

    const record = await db.findTokenByHash(crypto.createHash("sha256").update(token).digest("hex"));
    if (!record || record.token_type !== "access" || record.revoked_at || new Date(record.expires_at) <= new Date()) {
      return res.status(401).json({ error: "授权已失效，请重新激活" });
    }
    if (record.device_hash !== crypto.createHash("sha256").update(deviceId).digest("hex")) {
      return res.status(403).json({ error: "设备不匹配" });
    }
    if (record.device_status !== "active" || record.code_status !== "active" || record.user_status !== "active") {
      return res.status(403).json({ error: "授权已被撤销或设备已解绑" });
    }

    await db.touchDevice(record.device_id);
    req.auth = {
      userId: record.user_id,
      deviceId: record.device_id,
      phone: record.phone,
      deviceHash: record.device_hash,
    };
    next();
  } catch (error) {
    console.error("认证失败:", error.message);
    return res.status(500).json({ error: "认证服务暂时不可用" });
  }
}

function createAccessToken() {
  return `atk_${crypto.randomBytes(32).toString("hex")}`;
}

function createRefreshToken() {
  return `rtk_${crypto.randomBytes(32).toString("hex")}`;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function tokenExpires(seconds) {
  return new Date(Date.now() + seconds * 1000);
}

module.exports = {
  authenticate,
  bearerToken,
  createAccessToken,
  createRefreshToken,
  tokenHash,
  tokenExpires,
};
