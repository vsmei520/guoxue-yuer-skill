const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const db = require("./config/database");
const activateRouter = require("./routes/activate");
const authRouter = require("./routes/auth");
const mcpRouter = require("./routes/mcp");
const adminRouter = require("./routes/admin");

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || "https://guoxue.073955.com",
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  max: Number(process.env.RATE_LIMIT_MAX || 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "请求过于频繁，请稍后再试" },
}));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "guoxue-server",
    version: "1.1.0",
  });
});

app.use("/activate", activateRouter);
app.use("/auth", authRouter);
app.use("/mcp", mcpRouter);
app.use("/admin", adminRouter);

app.use((req, res) => res.status(404).json({ error: "Not Found" }));
app.use((error, req, res, next) => {
  console.error("服务器错误:", error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "服务器暂时不可用" });
});

async function start() {
  await db.initDatabase();
  const server = app.listen(port, () => {
    console.log(`服务器运行在端口 ${port}`);
    console.log(`环境: ${process.env.NODE_ENV || "development"}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

start().catch((error) => {
  console.error("服务启动失败:", error.message);
  process.exit(1);
});
