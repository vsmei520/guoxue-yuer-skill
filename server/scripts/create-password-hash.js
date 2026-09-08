const bcrypt = require("bcrypt");

const password = process.argv[2];
if (!password) {
  console.error("用法: node scripts/create-password-hash.js 你的管理员密码");
  process.exit(1);
}

bcrypt.hash(password, 12).then((value) => {
  process.stdout.write(`${value}\n`);
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
