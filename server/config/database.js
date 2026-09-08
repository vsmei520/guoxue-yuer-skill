const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS redemption_codes (
  id BIGSERIAL PRIMARY KEY,
  code_hash CHAR(64) NOT NULL UNIQUE,
  code_mask VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  max_devices INTEGER NOT NULL DEFAULT 1 CHECK (max_devices > 0),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devices (
  id BIGSERIAL PRIMARY KEY,
  device_hash CHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  code_id BIGINT NOT NULL REFERENCES redemption_codes(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unbound', 'revoked')),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unbound_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS devices_code_id_status_idx ON devices(code_id, status);

CREATE TABLE IF NOT EXISTS access_tokens (
  id BIGSERIAL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  device_id BIGINT NOT NULL REFERENCES devices(id),
  token_type VARCHAR(20) NOT NULL CHECK (token_type IN ('access', 'refresh')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_tokens_device_idx ON access_tokens(device_id, token_type);

CREATE TABLE IF NOT EXISTS runtime_sessions (
  id VARCHAR(80) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  device_id BIGINT NOT NULL REFERENCES devices(id),
  topic TEXT NOT NULL,
  structure TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_stage INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(40),
  target_id VARCHAR(120),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip VARCHAR(80),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC);
`;

async function initDatabase() {
  if (!process.env.DB_NAME || !process.env.DB_USER) {
    throw new Error("缺少 PostgreSQL 配置，请检查 .env 中的 DB_NAME 和 DB_USER");
  }
  await pool.query(schemaSql);
}

function newSessionId() {
  return `ses_${crypto.randomBytes(18).toString("hex")}`;
}

async function activateLicense({ phone, codeHash, deviceHash, accessTokenHash, refreshTokenHash, accessExpiresAt, refreshExpiresAt }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const codeResult = await client.query(
      `SELECT * FROM redemption_codes WHERE code_hash = $1 FOR UPDATE`,
      [codeHash]
    );
    const code = codeResult.rows[0];
    if (!code) throw Object.assign(new Error("授权码不存在或已失效"), { status: 404 });
    if (code.status !== "active") throw Object.assign(new Error("授权码已被撤销"), { status: 403 });
    if (code.expires_at && new Date(code.expires_at) <= new Date()) {
      throw Object.assign(new Error("授权码已过期"), { status: 403 });
    }

    let userResult = await client.query("SELECT * FROM users WHERE phone = $1 FOR UPDATE", [phone]);
    let user = userResult.rows[0];
    if (!user) {
      userResult = await client.query(
        "INSERT INTO users (phone) VALUES ($1) RETURNING *",
        [phone]
      );
      user = userResult.rows[0];
    }
    if (user.status !== "active") throw Object.assign(new Error("用户已被禁用"), { status: 403 });

    const deviceResult = await client.query(
      `SELECT d.*, rc.status AS code_status, rc.expires_at AS code_expires_at
       FROM devices d
       JOIN redemption_codes rc ON rc.id = d.code_id
       WHERE d.device_hash = $1
       FOR UPDATE`,
      [deviceHash]
    );
    let device = deviceResult.rows[0];

    if (device) {
      if (String(device.code_id) !== String(code.id)) {
        throw Object.assign(new Error("此设备已绑定其他授权码"), { status: 403 });
      }
      if (device.status === "revoked") {
        throw Object.assign(new Error("设备已被撤销"), { status: 403 });
      }
      if (device.status === "unbound") {
        const countResult = await client.query(
          "SELECT COUNT(*)::int AS count FROM devices WHERE code_id = $1 AND status = 'active'",
          [code.id]
        );
        if (countResult.rows[0].count >= code.max_devices) {
          throw Object.assign(new Error("此授权码已达到设备绑定上限（一机一码）"), { status: 403 });
        }
        await client.query(
          `UPDATE devices SET status = 'active', user_id = $1, bound_at = NOW(),
                  last_used_at = NOW(), unbound_at = NULL, revoked_at = NULL
           WHERE id = $2`,
          [user.id, device.id]
        );
        device.status = "active";
      } else {
        await client.query("UPDATE devices SET last_used_at = NOW(), user_id = $1 WHERE id = $2", [user.id, device.id]);
      }
    } else {
      const countResult = await client.query(
        "SELECT COUNT(*)::int AS count FROM devices WHERE code_id = $1 AND status = 'active'",
        [code.id]
      );
      if (countResult.rows[0].count >= code.max_devices) {
        throw Object.assign(new Error("此授权码已达到设备绑定上限（一机一码）"), { status: 403 });
      }
      const createdDevice = await client.query(
        `INSERT INTO devices (device_hash, user_id, code_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [deviceHash, user.id, code.id]
      );
      device = createdDevice.rows[0];
    }

    await client.query(
      `INSERT INTO access_tokens (token_hash, user_id, device_id, token_type, expires_at)
       VALUES ($1, $2, $3, 'access', $4), ($5, $2, $3, 'refresh', $6)`,
      [accessTokenHash, user.id, device.id, accessExpiresAt, refreshTokenHash, refreshExpiresAt]
    );

    await client.query("COMMIT");
    return { user, device, code };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function findTokenByHash(tokenHash) {
  const result = await pool.query(
    `SELECT t.*, d.status AS device_status, d.device_hash, d.last_used_at,
            rc.status AS code_status, rc.expires_at AS code_expires_at,
            u.status AS user_status
     FROM access_tokens t
     JOIN devices d ON d.id = t.device_id
     JOIN redemption_codes rc ON rc.id = d.code_id
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function touchDevice(deviceId) {
  await pool.query("UPDATE devices SET last_used_at = NOW() WHERE id = $1", [deviceId]);
}

async function rotateRefreshToken({ oldTokenHash, deviceHash, accessTokenHash, refreshTokenHash, accessExpiresAt, refreshExpiresAt }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tokenResult = await client.query(
      `SELECT t.*, d.status AS device_status, rc.status AS code_status, rc.expires_at AS code_expires_at,
              u.status AS user_status
       FROM access_tokens t
       JOIN devices d ON d.id = t.device_id
       JOIN redemption_codes rc ON rc.id = d.code_id
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.token_type = 'refresh' AND d.device_hash = $2
       FOR UPDATE`,
      [oldTokenHash, deviceHash]
    );
    const oldToken = tokenResult.rows[0];
    if (!oldToken || oldToken.revoked_at || new Date(oldToken.expires_at) <= new Date()) {
      throw Object.assign(new Error("刷新令牌无效或已过期"), { status: 401 });
    }
    if (oldToken.device_status !== "active" || oldToken.code_status !== "active" || oldToken.user_status !== "active") {
      throw Object.assign(new Error("授权已失效"), { status: 403 });
    }

    await client.query("UPDATE access_tokens SET revoked_at = NOW() WHERE id = $1", [oldToken.id]);
    await client.query(
      `INSERT INTO access_tokens (token_hash, user_id, device_id, token_type, expires_at)
       VALUES ($1, $2, $3, 'access', $4), ($5, $2, $3, 'refresh', $6)`,
      [accessTokenHash, oldToken.user_id, oldToken.device_id, accessExpiresAt, refreshTokenHash, refreshExpiresAt]
    );
    await client.query("UPDATE devices SET last_used_at = NOW() WHERE id = $1", [oldToken.device_id]);
    await client.query("COMMIT");
    return { userId: oldToken.user_id, deviceId: oldToken.device_id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getAuthStatus(userId, deviceId) {
  const result = await pool.query(
    `SELECT u.phone, u.status AS user_status, d.status AS device_status, d.last_used_at,
            rc.status AS code_status, rc.expires_at AS code_expires_at
     FROM users u
     JOIN devices d ON d.user_id = u.id
     JOIN redemption_codes rc ON rc.id = d.code_id
     WHERE u.id = $1 AND d.id = $2`,
    [userId, deviceId]
  );
  return result.rows[0] || null;
}

async function findRefreshToken(refreshTokenHash, deviceHash) {
  const result = await pool.query(
    `SELECT t.*
     FROM access_tokens t
     JOIN devices d ON d.id = t.device_id
     WHERE t.token_hash = $1 AND t.token_type = 'refresh' AND d.device_hash = $2`,
    [refreshTokenHash, deviceHash]
  );
  return result.rows[0] || null;
}

async function createSession(userId, deviceId, data) {
  const id = newSessionId();
  const result = await pool.query(
    `INSERT INTO runtime_sessions (id, user_id, device_id, topic, structure, data, current_stage)
     VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING *`,
    [id, userId, deviceId, data.topic, data.structure, JSON.stringify(data)]
  );
  return result.rows[0];
}

async function findSessionById(sessionId) {
  const result = await pool.query("SELECT * FROM runtime_sessions WHERE id = $1", [sessionId]);
  return result.rows[0] || null;
}

async function updateSession(sessionId, updates) {
  const result = await pool.query(
    `UPDATE runtime_sessions
     SET current_stage = COALESCE($2, current_stage),
         data = COALESCE($3, data),
         status = COALESCE($4, status),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [sessionId, updates.currentStage ?? null, updates.data ? JSON.stringify(updates.data) : null, updates.status ?? null]
  );
  return result.rows[0] || null;
}

async function createRedemptionCodes(items) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = [];
    for (const item of items) {
      const result = await client.query(
        `INSERT INTO redemption_codes (code_hash, code_mask, expires_at)
         VALUES ($1, $2, $3) RETURNING id, code_mask, status, expires_at, created_at`,
        [item.codeHash, item.codeMask, item.expiresAt]
      );
      created.push({ ...result.rows[0], code: item.code });
    }
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listAdminOverview() {
  const codes = await pool.query(
    `SELECT rc.id, rc.code_mask, rc.status, rc.expires_at, rc.created_at,
            d.id AS device_id, d.status AS device_status, d.last_used_at,
            u.phone
     FROM redemption_codes rc
     LEFT JOIN devices d ON d.code_id = rc.id AND d.status <> 'unbound'
     LEFT JOIN users u ON u.id = d.user_id
     ORDER BY rc.created_at DESC
     LIMIT 200`
  );
  return codes.rows;
}

async function revokeCode(codeId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE redemption_codes SET status = 'revoked', revoked_at = NOW() WHERE id = $1", [codeId]);
    await client.query(
      `UPDATE devices SET status = 'revoked', revoked_at = NOW()
       WHERE code_id = $1 AND status = 'active'`,
      [codeId]
    );
    await client.query(
      `UPDATE access_tokens SET revoked_at = NOW()
       WHERE device_id IN (SELECT id FROM devices WHERE code_id = $1) AND revoked_at IS NULL`,
      [codeId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function unbindDevice(deviceId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE devices SET status = 'unbound', unbound_at = NOW()
       WHERE id = $1 AND status = 'active'`,
      [deviceId]
    );
    await client.query(
      `UPDATE access_tokens SET revoked_at = NOW()
       WHERE device_id = $1 AND revoked_at IS NULL`,
      [deviceId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function addAuditLog({ action, targetType, targetId, details, ip, userAgent }) {
  await pool.query(
    `INSERT INTO audit_logs (action, target_type, target_id, details, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [action, targetType || null, targetId || null, JSON.stringify(details || {}), ip || null, userAgent || null]
  );
}

async function close() {
  await pool.end();
}

module.exports = {
  initDatabase,
  activateLicense,
  findTokenByHash,
  touchDevice,
  rotateRefreshToken,
  getAuthStatus,
  findRefreshToken,
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
