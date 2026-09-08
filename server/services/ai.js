const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const db = require("../config/database");

const configuredSkillPath = process.env.SKILL_FILES_PATH || "./skills";
const skillPath = path.isAbsolute(configuredSkillPath)
  ? configuredSkillPath
  : path.resolve(__dirname, "..", configuredSkillPath);

async function loadSkillFiles() {
  try {
    const [rules, examples] = await Promise.all([
      fs.readFile(path.join(skillPath, "rules.md"), "utf8"),
      fs.readFile(path.join(skillPath, "examples.md"), "utf8"),
    ]);
    return { rules, examples };
  } catch (error) {
    console.error("加载 Skill 文件失败:", error.message);
    throw new Error("服务端规则文件未就绪");
  }
}

function getAIConfig() {
  const provider = String(process.env.AI_PROVIDER || "openai").toLowerCase();
  if (provider === "claude") {
    if (!process.env.CLAUDE_API_KEY) throw new Error("服务器 AI 尚未配置");
    return {
      provider,
      apiKey: process.env.CLAUDE_API_KEY,
      baseUrl: process.env.CLAUDE_BASE_URL || "https://api.anthropic.com/v1",
      model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
    };
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("服务器 AI 尚未配置");
  return {
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
}

async function callAI(messages, temperature = 0.7) {
  const config = getAIConfig();
  const requestConfig = {
    headers: { "Content-Type": "application/json" },
    timeout: Number(process.env.AI_TIMEOUT_MS || 120000),
  };

  try {
    if (config.provider === "claude") {
      const system = messages.find((message) => message.role === "system");
      const userMessages = messages.filter((message) => message.role !== "system");
      requestConfig.headers["x-api-key"] = config.apiKey;
      requestConfig.headers["anthropic-version"] = "2023-06-01";
      const response = await axios.post(`${config.baseUrl}/messages`, {
        model: config.model,
        max_tokens: Number(process.env.AI_MAX_TOKENS || 4000),
        temperature,
        system: system?.content || "",
        messages: userMessages,
      }, requestConfig);
      return response.data.content?.[0]?.text || "";
    }

    requestConfig.headers.Authorization = `Bearer ${config.apiKey}`;
    const response = await axios.post(`${config.baseUrl}/chat/completions`, {
      model: config.model,
      messages,
      temperature,
      max_tokens: Number(process.env.AI_MAX_TOKENS || 4000),
    }, requestConfig);
    return response.data.choices?.[0]?.message?.content || "";
  } catch (error) {
    console.error("AI 服务调用失败:", error.response?.status || error.message);
    throw new Error("AI 服务暂时不可用，请稍后重试");
  }
}

function systemPrompt(rules, examples) {
  return `你是曾美团队的古今对话短剧创作专家。\n\n${rules}\n\n${examples}\n\n请严格按照以上规则执行。`;
}

async function generateStage1(topic, structure, userId, deviceId) {
  const { rules, examples } = await loadSkillFiles();
  const result = await callAI([
    { role: "system", content: systemPrompt(rules, examples) },
    {
      role: "user",
      content: `请执行第一阶段：钩子分析 + 典故取材\n\n选题：${topic}\n\n初步构思：${structure}\n\n请开始第一阶段的创作，输出钩子分析和典故取材表。`,
    },
  ]);

  const session = await db.createSession(userId, deviceId, {
    topic,
    structure,
    stage1Output: result,
  });
  return `会话已创建，ID: ${session.id}\n\n${result}\n\n---\n请确认后继续下一阶段。使用 sessionId: ${session.id}`;
}

async function generateStage(sessionId, stageNum, userId, deviceId) {
  if (!Number.isInteger(stageNum) || stageNum < 2 || stageNum > 8) {
    throw new Error("阶段编号无效");
  }
  const session = await db.findSessionById(sessionId);
  if (!session) throw new Error("会话不存在");
  if (String(session.user_id) !== String(userId) || String(session.device_id) !== String(deviceId)) {
    throw new Error("无权访问此会话");
  }

  const { rules, examples } = await loadSkillFiles();
  const contextMessages = [
    { role: "system", content: systemPrompt(rules, examples) },
    { role: "user", content: `选题：${session.topic}\n\n初步构思：${session.structure}` },
  ];
  const data = session.data || {};
  for (let i = 1; i < stageNum; i += 1) {
    if (data[`stage${i}Output`]) {
      contextMessages.push({ role: "assistant", content: data[`stage${i}Output`] });
      contextMessages.push({ role: "user", content: "已确认，继续下一阶段。" });
    }
  }
  contextMessages.push({ role: "user", content: `请执行第${stageNum}阶段的创作。` });

  const result = await callAI(contextMessages);
  await db.updateSession(sessionId, {
    currentStage: stageNum,
    data: { ...data, [`stage${stageNum}Output`]: result },
    status: stageNum === 8 ? "completed" : "active",
  });
  return `${result}\n\n---\n${stageNum < 8 ? "请确认后继续下一阶段。" : "全部阶段已完成！"}`;
}

module.exports = { generateStage1, generateStage };
