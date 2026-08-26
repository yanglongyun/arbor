// @ts-nocheck
// 多智能体两件套:派生兄弟智能体 / 给已存在的智能体发消息。都是异步 ——
// 立即返回,对方跑完后最终回复作为新消息投回自己的邮箱(runs 层负责回投与唤醒)。
import { EVENTS } from "../shared/events.js";

export const createAgentDef = {
  type: "function",
  name: "create_agent",
  description:
    "在你所在的文件夹下创建一个新智能体。如果提供 message,会同时派发该初始消息(异步,不阻塞);" +
    "对方跑完后,它的最终回复会自动作为新消息投进你的邮箱。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么创建(界面会显示)" },
      title: { type: "string", description: "智能体名字" },
      message: { type: "string", description: "可选:初始消息" },
      system: { type: "string", description: "可选:智能体的 system prompt" },
    },
    required: ["summary", "title"],
    additionalProperties: false,
  },
};

export const create_agent = ({ title, message, system }, ctx) => {
  // 新智能体和自己同一个家(workdir)—— 「在你所在文件夹里派生」的语义不变
  const created = ctx.createAgent({
    title: String(title || "new agent"),
    system: system ? String(system) : null,
    workdir: ctx.cwd,
  });
  ctx.emit({ type: "agents_changed" });

  if (message != null && String(message).trim()) {
    const row = ctx.appendItem(
      created.id,
      { role: "user", content: String(message) },
      { meta: { kind: "call", source: "call", from: ctx.selfAgentId } },
    );
    ctx.touchAgent(created.id);
    ctx.emit({ type: EVENTS.INPUT, agentId: created.id, row });
    ctx.runAgent(created.id, { callerId: ctx.selfAgentId }).catch((e) =>
      console.error("[create_agent] wake failed:", e?.message),
    );
    return `created agent "${created.title}" (id=${created.id}). initial message dispatched; reply will arrive in your mailbox.`;
  }
  return `created agent "${created.title}" (id=${created.id}).`;
};

export const callAgentDef = {
  type: "function",
  name: "call_agent",
  description:
    "给已存在的智能体发一条消息,异步,立即返回。对方跑完后,它的最终回复会自动作为新消息投进你的邮箱。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么调它(界面会显示)" },
      agent_id: { type: "string", description: "目标智能体的 id" },
      message: { type: "string", description: "要发送的消息" },
    },
    required: ["summary", "agent_id", "message"],
    additionalProperties: false,
  },
};

export const call_agent = ({ agent_id, message }, ctx) => {
  const targetId = String(agent_id || "").trim();
  if (!targetId) return "agent_id is required";
  const target = ctx.getAgent(targetId);
  if (!target) return `agent not found: ${targetId}`;

  const row = ctx.appendItem(
    targetId,
    { role: "user", content: String(message || "") },
    { meta: { kind: "call", source: "call", from: ctx.selfAgentId } },
  );
  ctx.touchAgent(targetId);
  ctx.emit({ type: EVENTS.INPUT, agentId: targetId, row });
  ctx.runAgent(targetId, { callerId: ctx.selfAgentId }).catch((e) =>
    console.error("[call_agent] wake failed:", e?.message),
  );
  return `dispatched to "${target.title}" (id=${targetId}). reply will arrive in your mailbox as a new message.`;
};
