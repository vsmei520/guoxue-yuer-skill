const express = require("express");
const { authenticate } = require("../utils/auth");
const aiService = require("../services/ai");

const router = express.Router();

const tools = [
  {
    name: "generate_stage_1",
    description: "生成第一阶段：钩子分析 + 典故取材",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "选题" },
        structure: { type: "string", description: "初步构思" },
      },
      required: ["topic", "structure"],
    },
  },
  ...[
    [2, "结构设计 + 人物档案 + 时长精算"],
    [3, "四列脚本"],
    [4, "场景图 + 人物设定图 + 角色定位图提示词"],
    [5, "六列分镜表 + 10秒分割方案"],
    [6, "Seedance 分段提示词"],
    [7, "封面提示词（3:4 + 4:3）"],
    [8, "发布标题 + 标签 + 知识点清单"],
  ].map(([stage, description]) => ({
    name: `generate_stage_${stage}`,
    description: `生成第${stage}阶段：${description}`,
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "会话ID" } },
      required: ["sessionId"],
    },
  })),
];

function response(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function validText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

router.post("/", async (req, res) => {
  const { jsonrpc, id, method, params = {} } = req.body || {};
  if (jsonrpc !== "2.0") return res.json(errorResponse(id, -32600, "Invalid Request"));

  if (method === "tools/list") return res.json(response(id, { tools }));
  if (method !== "tools/call") return res.json(errorResponse(id, -32601, "Method not found"));

  await authenticate(req, res, async () => {
    const name = params.name;
    const args = params.arguments || {};
    let text;

    try {
      if (name === "generate_stage_1") {
        if (!validText(args.topic, 500) || !validText(args.structure, 5000)) {
          return res.json(errorResponse(id, -32602, "选题和初步构思不能为空且长度不正确"));
        }
        text = await aiService.generateStage1(
          args.topic.trim(),
          args.structure.trim(),
          req.auth.userId,
          req.auth.deviceId
        );
      } else if (/^generate_stage_[2-8]$/.test(name)) {
        if (!validText(args.sessionId, 80)) {
          return res.json(errorResponse(id, -32602, "sessionId 不正确"));
        }
        text = await aiService.generateStage(
          args.sessionId.trim(),
          Number(name.split("_").pop()),
          req.auth.userId,
          req.auth.deviceId
        );
      } else {
        return res.json(errorResponse(id, -32601, "Method not found"));
      }

      return res.json(response(id, { content: [{ type: "text", text }], isError: false }));
    } catch (error) {
      console.error("MCP 生成失败:", error.message);
      return res.json(errorResponse(id, -32000, error.message || "生成失败"));
    }
  });
});

module.exports = router;
