# 曾美团队·育儿国风穿越

古今对话短剧 AI 视频生产系统 - 远程授权插件

## 功能特点

- **远程授权模式**：核心规则存储在远程服务器
- **OAuth 认证**：使用标准 MCP OAuth 协议
- **本地 AI 执行**：使用您在 Claude Desktop 配置的 API 密钥
- **分阶段创作**：完整的视频生产工作流

## 安装步骤

### 1. 安装插件

将插件解压到 Claude Code 的插件目录。

### 2. 激活授权

1. 访问激活页面：https://guoxue.073955.com/redeem
2. 输入手机号和授权码
3. 复制显示的 **Client ID** 和 **Client Secret**

### 3. 配置 Claude Desktop

打开 Claude Desktop 设置，添加 MCP 服务器配置：

```json
{
  "mcpServers": {
    "guoxue-chuanyue": {
      "type": "http",
      "url": "https://guoxue.073955.com/mcp",
      "auth": "oauth",
      "oauth": {
        "clientId": "您的Client ID",
        "clientSecret": "您的Client Secret"
      }
    }
  }
}
```

### 4. 重启并使用

重启 Claude Desktop，即可开始使用。

## 使用方法

在 Claude 中输入：

```
帮我生成一个育儿国风短视频

选题：孩子不爱吃饭怎么办

初步构思：通过苏轼的故事，讲述"食不厌精"的智慧
```

## 授权说明

- **一机一码**：每个授权码只能激活一次
- **本地 API**：使用您自己在 Claude Desktop 配置的 API 密钥
- **数据安全**：核心规则在服务器，您的 API 密钥在本地

## 获取授权码

请联系管理员获取授权码。

## 技术支持

如有问题请联系曾美团队。
