// 内存数据库（简单版，重启后数据会丢失）
const memoryDB = {
  users: new Map(),
  codes: new Map(),
  devices: new Map(),
  tokens: new Map(),
  sessions: new Map(),
};

// 初始化测试授权码
function initDatabase() {
  const crypto = require("crypto");
  const testCodeHash = crypto.createHash("sha256").update("GX123456789ABC").digest("hex");
  memoryDB.codes.set(testCodeHash, {
    id: 1,
    codeHash: testCodeHash,
    codeMask: "GX12********9ABC",
    status: "active",
    maxDevices: 1,
    expiresAt: null,
    createdAt: new Date(),
  });
  console.log("✅ 测试授权码已初始化: GX123456789ABC");
  return Promise.resolve();
}

async function activateLicense({ phone, codeHash, deviceHash, accessTokenHash, refreshTokenHash, accessExpiresAt, refreshExpiresAt }) {
  const code = memoryDB.codes.get(codeHash);
  if (!code) throw Object.assign(new Error("授权码不存在"), { status: 404 });
  if (code.status !== "active") throw Object.assign(new Error("授权码已被撤销"), { status: 403 });
  if (code.expiresAt && new Date(code.expiresAt) <= new Date()) {
    throw Object.assign(new Error("授权码已过期"), { status: 403 });
  }

  let user = Array.from(memoryDB.users.values()).find((u) => u.phone === phone);
  if (!user) {
    user = { id: Date.now(), phone, status: "active", createdAt: new Date() };
    memoryDB.users.set(user.id, user);
  }

  let device = memoryDB.devices.get(deviceHash);
  if (device) {
    if (device.codeId !== code.id) throw Object.assign(new Error("此设备已绑定其他授权码"), { status: 403 });
    if (device.status === "revoked") throw Object.assign(new Error("设备已被撤销"), { status: 403 });
    if (device.status === "unbound") {
      const activeCount = Array.from(memoryDB.devices.values()).filter((d) => d.codeId === code.id && d.status === "active").length;
      if (activeCount >= code.maxDevices) throw Object.assign(new Error("此授权码已达到设备绑定上限"), { status: 403 });
      device.status = "active";
      device.userId = user.id;
      device.boundAt = new Date();
    }
    device.lastUsedAt = new Date();
  } else {
    const activeCount = Array.from(memoryDB.devices.values()).filter((d) => d.codeId === code.id && d.status === "active").length;
    if (activeCount >= code.maxDevices) throw Object.assign(new Error("此授权码已达到设备绑定上限"), { status: 403 });
    device = {
      id: Date.now(),
      deviceHash,
      userId: user.id,
      codeId: code.id,
      status: "active",
      boundAt: new Date(),
      lastUsedAt: new Date(),
    };
    memoryDB.devices.set(deviceHash, device);
  }

  memoryDB.tokens.set(accessTokenHash, { tokenHash: accessTokenHash, userId: user.id, deviceId: device.id, tokenType: "access", expiresAt: accessExpiresAt, createdAt: new Date() });
  memoryDB.tokens.set(refreshTokenHash, { tokenHash: refreshTokenHash, userId: user.id, deviceId: device.id, tokenType: "refresh", expiresAt: refreshExpiresAt, createdAt: new Date() });

  return { user, device, code };
}

async function findTokenByHash(tokenHash) {
  const token = memoryDB.tokens.get(tokenHash);
  if (!token) return null;
  const device = Array.from(memoryDB.devices.values()).find((d) => d.id === token.deviceId);
  if (!device) return null;
  const code = Array.from(memoryDB.codes.values()).find((c) => c.id === device.codeId);
  const user = memoryDB.users.get(token.userId);
  return {
    ...token,
    device_hash: device.deviceHash,
    device_status: device.status,
    code_status: code?.status,
    code_expires_at: code?.expiresAt,
    user_status: user?.status,
    phone: user?.phone,
  };
}

async function touchDevice(deviceId) {
  const device = Array.from(memoryDB.devices.values()).find((d) => d.id === deviceId);
  if (device) device.lastUsedAt = new Date();
}

async function rotateRefreshToken({ oldTokenHash, deviceHash, accessTokenHash, refreshTokenHash, accessExpiresAt, refreshExpiresAt }) {
  const oldToken = memoryDB.tokens.get(oldTokenHash);
  if (!oldToken || oldToken.tokenType !== "refresh" || oldToken.revokedAt || new Date(oldToken.expiresAt) <= new Date()) {
    throw Object.assign(new Error("刷新令牌无效或已过期"), { status: 401 });
  }
  const device = Array.from(memoryDB.devices.values()).find((d) => d.id === oldToken.deviceId && d.deviceHash === deviceHash);
  if (!device || device.status !== "active") throw Object.assign(new Error("授权已失效"), { status: 403 });

  oldToken.revokedAt = new Date();
  memoryDB.tokens.set(accessTokenHash, { tokenHash: accessTokenHash, userId: oldToken.userId, deviceId: oldToken.deviceId, tokenType: "access", expiresAt: accessExpiresAt, createdAt: new Date() });
  memoryDB.tokens.set(refreshTokenHash, { tokenHash: refreshTokenHash, userId: oldToken.userId, deviceId: oldToken.deviceId, tokenType: "refresh", expiresAt: refreshExpiresAt, createdAt: new Date() });
  device.lastUsedAt = new Date();
  return { userId: oldToken.userId, deviceId: oldToken.deviceId };
}

async function getAuthStatus(userId, deviceId) {
  const device = Array.from(memoryDB.devices.values()).find((d) => d.id === deviceId);
  if (!device) return null;
  const user = memoryDB.users.get(userId);
  const code = Array.from(memoryDB.codes.values()).find((c) => c.id === device.codeId);
  return {
    phone: user?.phone,
    user_status: user?.status,
    device_status: device.status,
    last_used_at: device.lastUsedAt,
    code_status: code?.status,
    code_expires_at: code?.expiresAt,
  };
}

async function createSession(userId, deviceId, data) {
  const crypto = require("crypto");
  const id = `ses_${crypto.randomBytes(18).toString("hex")}`;
  const session = { id, user_id: userId, device_id: deviceId, topic: data.topic, structure: data.structure, data, current_stage: 1, status: "active", created_at: new Date() };
  memoryDB.sessions.set(id, session);
  return session;
}

async function findSessionById(sessionId) {
  return memoryDB.sessions.get(sessionId) || null;
}

async function updateSession(sessionId, updates) {
  const session = memoryDB.sessions.get(sessionId);
  if (!session) return null;
  if (updates.currentStage) session.current_stage = updates.currentStage;
  if (updates.data) session.data = updates.data;
  if (updates.status) session.status = updates.status;
  session.updated_at = new Date();
  return session;
}

async function createRedemptionCodes(items) {
  const results = items.map((item) => {
    const code = { id: Date.now() + Math.random(), codeHash: item.codeHash, codeMask: item.codeMask, status: "active", maxDevices: 1, expiresAt: item.expiresAt, createdAt: new Date() };
    memoryDB.codes.set(item.codeHash, code);
    return { ...code, code: item.code };
  });
  return results;
}

async function listAdminOverview() {
  const results = [];
  for (const code of memoryDB.codes.values()) {
    const devices = Array.from(memoryDB.devices.values()).filter((d) => d.codeId === code.id && d.status !== "unbound");
    if (devices.length === 0) {
      results.push({ id: code.id, code_mask: code.codeMask, status: code.status, expires_at: code.expiresAt, created_at: code.createdAt });
    } else {
      devices.forEach((device) => {
        const user = memoryDB.users.get(device.userId);
        results.push({
          id: code.id,
          code_mask: code.codeMask,
          status: code.status,
          expires_at: code.expiresAt,
          created_at: code.createdAt,
          device_id: device.id,
          device_status: device.status,
          last_used_at: device.lastUsedAt,
          phone: user?.phone,
        });
      });
    }
  }
  return results.slice(0, 200);
}

async function revokeCode(codeId) {
  const code = Array.from(memoryDB.codes.values()).find((c) => c.id == codeId);
  if (code) {
    code.status = "revoked";
    code.revokedAt = new Date();
    Array.from(memoryDB.devices.values()).filter((d) => d.codeId === code.id && d.status === "active").forEach((d) => {
      d.status = "revoked";
      d.revokedAt = new Date();
    });
    Array.from(memoryDB.tokens.values()).filter((t) => {
      const device = Array.from(memoryDB.devices.values()).find((d) => d.id === t.deviceId);
      return device && device.codeId === code.id;
    }).forEach((t) => {
      t.revokedAt = new Date();
    });
  }
}

async function unbindDevice(deviceId) {
  const device = Array.from(memoryDB.devices.values()).find((d) => d.id == deviceId);
  if (device && device.status === "active") {
    device.status = "unbound";
    device.unboundAt = new Date();
    Array.from(memoryDB.tokens.values()).filter((t) => t.deviceId === device.id && !t.revokedAt).forEach((t) => {
      t.revokedAt = new Date();
    });
  }
}

async function addAuditLog() {
  // 内存版本不记录审计日志
}

async function close() {
  // 无需关闭
}

module.exports = {
  initDatabase,
  activateLicense,
  findTokenByHash,
  touchDevice,
  rotateRefreshToken,
  getAuthStatus,
  createSession,
  findSessionById,
  updateSession,
  createRedemptionCodes,
  listAdminOverview,
  revokeCode,
  unbindDevice,
  addAuditLog,
  close,
};
