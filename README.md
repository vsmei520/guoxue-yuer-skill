# 曾美团队·育儿国风穿越

古今对话短剧 AI 视频生产系统 - 远程授权插件

## 项目简介

基于 MCP (Model Context Protocol) 的远程授权创作插件，通过 OAuth 认证保护核心规则，用户使用自己的 API 密钥在本地执行创作流程。

### 核心特性

- ✅ **MCP OAuth 认证**：标准协议，安全可靠
- ✅ **规则远程保护**：核心 workflow 存储在服务器
- ✅ **本地 AI 执行**：使用用户自己的 API 密钥
- ✅ **SQLite 持久化**：授权数据不丢失
- ✅ **一机一码绑定**：防止滥用

## 系统架构

```
┌─────────────────┐         ┌──────────────────┐
│  Claude Desktop │◄───────►│  授权服务器       │
│                 │  OAuth  │                  │
│ • 用户 API 密钥 │         │ • OAuth 认证      │
│ • 本地执行      │         │ • 返回 workflow   │
└─────────────────┘         └──────────────────┘
```

**关键设计**：
- 服务端不调用 AI，只验证授权并返回规则文件
- 客户端用本地 API 执行，用户承担费用
- 核心规则受保护，不会泄露

## 项目结构

```
guoxue-skill/
├── server/                    # 服务端
│   ├── src/
│   │   ├── server.js         # Express + MCP SDK
│   │   └── license-service.js # SQLite 授权管理
│   ├── workflows/            # 核心规则（不公开）
│   └── package.json
├── client/market-plugin/     # 市场插件
│   ├── .codex-plugin/
│   ├── .mcp.json            # MCP 配置
│   └── README.md
├── 部署指南.md               # 服务端部署文档
├── 开发文档.md               # 开发者文档
└── README.md                # 本文件
```

## 快速开始

### 服务端部署

详见 [部署指南.md](./部署指南.md)

**简要步骤**：
1. Node.js >= 22.0.0
2. 上传 `guoxue-server-oauth.zip` 到服务器
3. 配置 `.env` 文件
4. `npm install` + `pm2 start`
5. 配置反向代理

### 用户使用

1. 访问激活页面：https://guoxue.073955.com/redeem
2. 输入手机号和授权码
3. 复制 Client ID/Secret
4. 配置到 Claude Desktop
5. 开始创作

## 技术栈

**服务端**：
- Node.js 22+ (node:sqlite)
- Express 5.x
- @modelcontextprotocol/sdk 1.30+
- SQLite (内置)

**客户端**：
- 纯配置，无需代码

## 安全说明

- ✅ 核心 workflow 不提交到 GitHub
- ✅ 环境变量不提交
- ✅ 数据库不提交
- ✅ 授权码哈希存储
- ✅ OAuth 标准协议

## 文档

- [部署指南.md](./部署指南.md) - 服务端部署完整流程
- [开发文档.md](./开发文档.md) - 架构设计和开发指南

## 许可证

专有软件，版权所有 © 曾美团队

核心规则受知识产权保护，未经授权不得使用。

## 技术支持

内部项目，有问题请联系曾美团队。

---

**最新版本**：v1.2.0  
**更新日期**：2026-09-08  
**架构**：MCP OAuth + SQLite
