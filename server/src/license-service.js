const { createHash, randomBytes } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString();
}

function hashSecret(value) {
  return createHash("sha256").update(value).digest("hex");
}

function formatCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  const parts = [];
  for (let offset = 0; offset < 20; offset += 4) {
    let part = "";
    for (let index = offset; index < offset + 4; index += 1) {
      part += alphabet[bytes[index] % alphabet.length];
    }
    parts.push(part);
  }
  return `GX-${parts.join("-")}`;
}

class LicenseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "LicenseError";
  }
}

class LicenseService {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activation_codes (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        code_display TEXT NOT NULL,
        customer_id TEXT REFERENCES customers(id),
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        browser_device_id TEXT NOT NULL,
        label TEXT NOT NULL,
        activated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked_at TEXT,
        UNIQUE(customer_id, browser_device_id)
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        customer_id TEXT REFERENCES customers(id),
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  generateCodes(count, expiresInDays) {
    const codes = [];
    const now = nowIso();
    const expiresAt = expiresInDays ? addDays(now, expiresInDays) : null;

    for (let i = 0; i < count; i++) {
      const code = formatCode();
      const codeHash = hashSecret(code);
      const id = randomBytes(16).toString("hex");
      const codeDisplay = `${code.slice(0, 6)}****${code.slice(-6)}`;

      this.db.exec(`
        INSERT INTO activation_codes (id, code_hash, code_display, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, id, codeHash, codeDisplay, expiresAt, now);

      codes.push({ id, code, codeDisplay, expiresAt, createdAt: now });
    }
    return codes;
  }

  redeemCode(phone, code, deviceId, deviceLabel) {
    const codeHash = hashSecret(code);
    const now = nowIso();

    const codeRecord = this.db.prepare(`
      SELECT * FROM activation_codes WHERE code_hash = ? AND revoked_at IS NULL
    `).get(codeHash);

    if (!codeRecord) {
      throw new LicenseError("invalid_code", "授权码不存在或已被撤销");
    }

    if (codeRecord.expires_at && new Date(codeRecord.expires_at) <= new Date()) {
      throw new LicenseError("code_expired", "授权码已过期");
    }

    if (codeRecord.customer_id) {
      throw new LicenseError("code_used", "此授权码已被使用");
    }

    let customer = this.db.prepare("SELECT * FROM customers WHERE phone = ?").get(phone);
    if (!customer) {
      const customerId = randomBytes(16).toString("hex");
      this.db.exec("INSERT INTO customers (id, phone, created_at) VALUES (?, ?, ?)", customerId, phone, now);
      customer = { id: customerId, phone, created_at: now };
    }

    this.db.exec(`
      UPDATE activation_codes SET customer_id = ? WHERE id = ?
    `, customer.id, codeRecord.id);

    let device = this.db.prepare(`
      SELECT * FROM devices WHERE customer_id = ? AND browser_device_id = ?
    `).get(customer.id, deviceId);

    if (!device) {
      const deviceDbId = randomBytes(16).toString("hex");
      this.db.exec(`
        INSERT INTO devices (id, customer_id, browser_device_id, label, activated_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, deviceDbId, customer.id, deviceId, deviceLabel, now, now);
      device = { id: deviceDbId, customer_id: customer.id, browser_device_id: deviceId, label: deviceLabel };
    } else if (device.revoked_at) {
      throw new LicenseError("device_revoked", "此设备已被撤销");
    } else {
      this.db.exec("UPDATE devices SET last_seen_at = ? WHERE id = ?", now, device.id);
    }

    this.addAuditLog(customer.id, "code_redeemed", `phone=${phone}, device=${deviceLabel}`);

    return { customer, device, code: codeRecord };
  }

  verifyDevice(customerId, deviceId) {
    const device = this.db.prepare(`
      SELECT * FROM devices WHERE customer_id = ? AND browser_device_id = ? AND revoked_at IS NULL
    `).get(customerId, deviceId);

    if (!device) {
      throw new LicenseError("device_not_found", "设备未授权");
    }

    this.db.exec("UPDATE devices SET last_seen_at = ? WHERE id = ?", nowIso(), device.id);
    return device;
  }

  getCustomerByPhone(phone) {
    return this.db.prepare("SELECT * FROM customers WHERE phone = ?").get(phone);
  }

  listActivationCodes() {
    return this.db.prepare(`
      SELECT ac.*, c.phone,
             (SELECT COUNT(*) FROM devices d WHERE d.customer_id = ac.customer_id AND d.revoked_at IS NULL) as device_count
      FROM activation_codes ac
      LEFT JOIN customers c ON c.id = ac.customer_id
      ORDER BY ac.created_at DESC
      LIMIT 200
    `).all();
  }

  revokeCode(codeId) {
    const now = nowIso();
    this.db.exec("UPDATE activation_codes SET revoked_at = ? WHERE id = ?", now, codeId);

    const code = this.db.prepare("SELECT customer_id FROM activation_codes WHERE id = ?").get(codeId);
    if (code?.customer_id) {
      this.db.exec("UPDATE devices SET revoked_at = ? WHERE customer_id = ?", now, code.customer_id);
    }
  }

  revokeDevice(deviceId) {
    this.db.exec("UPDATE devices SET revoked_at = ? WHERE id = ?", nowIso(), deviceId);
  }

  addAuditLog(customerId, action, detail) {
    this.db.exec(`
      INSERT INTO audit_log (id, customer_id, action, detail, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, randomBytes(16).toString("hex"), customerId, action, detail, nowIso());
  }
}

module.exports = { LicenseError, LicenseService, hashSecret };
