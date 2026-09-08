# 曾美团队·育儿国风穿越

古今对话短剧 AI 视频生产系统 - 远程授权插件

## 项目简介

这是一个基于 MCP 协议的远程授权创作插件，用于生成育儿国风短视频的完整生产物。

### 核心特性

- **远程授权模式**：核心规则存储在服务器，本地插件通过授权访问
- **一机一码绑定**：使用手机号和授权码激活，保护知识产权
- **分阶段创作**：从钩子分析到发布标题，8 个阶段完整输出
- **PostgreSQL 持久化**：授权、设备、会话数据持久化存储
- **简洁管理后台**：原生 HTML 后台，生成、查看、撤销授权码

## 项目结构

```
guoxue-skill/
├── server/              # 服务端（Express + PostgreSQL）
│   ├── routes/          # 激活、认证、MCP、管理接口
│   ├── services/        # AI 调用服务
│   ├── config/          # 数据库配置
│   ├── utils/           # 工具函数
│   └── skills/          # 私有规则文件（不公开）
├── client/market-plugin/# 市场插件（手机号+授权码激活）
│   ├── mcp-proxy.js     # 客户端代理
│   ├── skills/          # 公开说明文件
│   └── README.md        # 用户使用指南
└── release/             # 发布包（不提交）
```

## 技术栈

**服务端**：
- Node.js 18+
- Express 4.x
- PostgreSQL
- Bcrypt（密码哈希）
- Axios（AI 调用）

**客户端**：
- Node.js 18+
- MCP 协议
- 本地加密存储（Windows DPAPI / Base64）

## 快速开始

### 服务端部署

1. **配置数据库**

```bash
# 创建数据库和用户
createdb guoxue_db
createuser guoxue_user
```

2. **配置环境变量**

```bash
cp server/.env.example server/.env
nano server/.env
```

必填：
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `ADMIN_PASSWORD_HASH`（使用 `npm run hash-password` 生成）
- `OPENAI_API_KEY` 或 `CLAUDE_API_KEY`

3. **安装依赖并启动**

```bash
cd server
npm install --production
pm2 start ecosystem.config.js
```

### 客户端安装

用户将 `client/market-plugin/` 解压到 Codex 插件目录，重启 Claude Desktop 即可。

## 使用流程

1. **激活授权**：调用 `activate_license`，填写手机号和授权码
2. **检查状态**：调用 `auth_status` 查看授权状态
3. **开始创作**：输入选题和构思，自动执行 8 个阶段

## 管理后台

访问 `https://your-domain.com/admin` 登录后可以：

- 生成授权码（支持批量和有效期）
- 查看授权状态
- 撤销授权码
- 解绑设备

## 安全说明

- **核心规则不公开**：`server/skills/` 目录的规则文件不提交到 GitHub
- **环境变量不公开**：`.env` 文件包含密钥，已在 `.gitignore` 中排除
- **授权码哈希存储**：明文授权码只在生成时显示一次
- **密码 Bcrypt 哈希**：管理员密码使用 bcrypt 加密存储
- **Token 加密**：客户端使用系统级加密保存 Token

## 开发

### 生成管理员密码哈希

```bash
cd server
npm run hash-password 你的密码
```

将输出的哈希填入 `.env` 的 `ADMIN_PASSWORD_HASH`。

### 本地开发

```bash
cd server
npm install
npm run dev
```

## 许可证

专有软件，版权所有 © 曾美团队

核心规则和算法受知识产权保护，未经授权不得使用。

## 技术支持

如有问题请联系曾美团队。
