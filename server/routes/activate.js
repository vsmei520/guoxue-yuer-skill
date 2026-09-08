const express = require("express");
const { hash, isValidPhone, isValidCodeFormat, isValidDeviceId } = require("../utils/crypto");
const {
  createAccessToken,
  createRefreshToken,
  tokenHash,
  tokenExpires,
} = require("../utils/auth");
const db = require("../config/database");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const phone = String(req.body.phone || "").trim();
    const code = String(req.body.code || "").trim().toUpperCase();
    const deviceId = String(req.body.deviceId || "").trim();

    if (!isValidPhone(phone)) return res.status(400).json({ error: "手机号格式不正确" });
    if (!isValidCodeFormat(code)) return res.status(400).json({ error: "授权码格式不正确" });
    if (!isValidDeviceId(deviceId)) return res.status(400).json({ error: "设备ID格式不正确" });

    const accessToken = createAccessToken();
    const refreshToken = createRefreshToken();
    const accessExpiresAt = tokenExpires(Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 3600));
    const refreshExpiresAt = tokenExpires(Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 604800));

    const result = await db.activateLicense({
      phone,
      codeHash: hash(code),
      deviceHash: hash(deviceId),
      accessTokenHash: tokenHash(accessToken),
      refreshTokenHash: tokenHash(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
    });

    await db.addAuditLog({
      action: "license.activate",
      targetType: "device",
      targetId: String(result.device.id),
      details: { codeId: String(result.code.id) },
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      accessToken,
      refreshToken,
      expiresIn: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 3600),
      tokenType: "Bearer",
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error("激活失败:", error.message);
    res.status(status).json({ error: status >= 500 ? "激活服务暂时不可用" : error.message });
  }
});

module.exports = router;
