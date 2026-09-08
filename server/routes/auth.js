const express = require("express");
const db = require("../config/database");
const {
  authenticate,
  createAccessToken,
  createRefreshToken,
  tokenHash,
  tokenExpires,
} = require("../utils/auth");
const { hash, isValidDeviceId } = require("../utils/crypto");

const router = express.Router();

router.get("/status", authenticate, async (req, res) => {
  const status = await db.getAuthStatus(req.auth.userId, req.auth.deviceId);
  if (!status) return res.status(404).json({ error: "授权状态不存在" });
  res.json({
    active: status.user_status === "active" && status.device_status === "active" && status.code_status === "active",
    phone: `${status.phone.slice(0, 3)}****${status.phone.slice(-4)}`,
    device: { status: status.device_status, lastUsedAt: status.last_used_at },
    license: { status: status.code_status, expiresAt: status.code_expires_at },
  });
});

router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || "").trim();
    const deviceId = String(req.body.deviceId || "").trim();
    if (!refreshToken || !isValidDeviceId(deviceId)) {
      return res.status(400).json({ error: "刷新参数不正确" });
    }

    const access = createAccessToken();
    const nextRefresh = createRefreshToken();
    const result = await db.rotateRefreshToken({
      oldTokenHash: tokenHash(refreshToken),
      deviceHash: hash(deviceId),
      accessTokenHash: tokenHash(access),
      refreshTokenHash: tokenHash(nextRefresh),
      accessExpiresAt: tokenExpires(Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 3600)),
      refreshExpiresAt: tokenExpires(Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 604800)),
    });

    res.json({
      accessToken: access,
      refreshToken: nextRefresh,
      expiresIn: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 3600),
      tokenType: "Bearer",
      deviceId,
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error("刷新授权失败:", error.message);
    res.status(status).json({ error: status >= 500 ? "刷新服务暂时不可用" : error.message });
  }
});

module.exports = router;
