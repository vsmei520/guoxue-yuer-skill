const crypto = require('crypto');

/**
 * 生成随机授权码
 */
function generateCode() {
  return 'GX' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

/**
 * 哈希函数（用于存储密码、授权码、设备ID等）
 */
function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * 生成随机 Token
 */
function generateToken(prefix = 'tok') {
  return `${prefix}_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * 验证授权码格式
 */
function isValidCodeFormat(code) {
  return /^GX[A-F0-9]{12}$/.test(code);
}

/**
 * 验证手机号格式
 */
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

/**
 * 验证设备ID格式
 */
function isValidDeviceId(deviceId) {
  return /^gx-[a-f0-9]{48}$/.test(deviceId);
}

module.exports = {
  generateCode,
  hash,
  generateToken,
  isValidCodeFormat,
  isValidPhone,
  isValidDeviceId
};
