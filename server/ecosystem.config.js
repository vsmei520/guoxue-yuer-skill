module.exports = {
  apps: [{
    name: "guoxue-server",
    cwd: __dirname,
    script: "./src/server.js",
    instances: 1,
    exec_mode: "fork",
    watch: false,
    max_memory_restart: "500M",
    env: { NODE_ENV: "production", PORT: 3110 },
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: "10s",
  }],
};
