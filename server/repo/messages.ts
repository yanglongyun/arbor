// @ts-nocheck
// 消息 = 每个智能体的邮箱,一行一个 Responses item。
// body 存 item 原文(user/system 消息、reasoning、message、function_call、function_call_output),
// meta 存邮箱语义(kind: message/call/call_result/compaction/marker,source/from 等),
// usage 存该轮用量(内核在每轮最后一个 item 上带回,压缩水位据此判断)。
import { getDb } from "../db.js";

const appendItem = (agentId, item, { meta = null, usage = null } = {}) => {
  const result = getDb()
    .prepare("INSERT INTO messages (agent_id, body, meta, usage) VALUES (?, ?, ?, ?)")
    .run(
      String(agentId),
      JSON.stringify(item),
      meta ? JSON.stringify(meta) : null,
      usage ? JSON.stringify(usage) : null,
    );
  const id = Number(result.lastInsertRowid);
  return { id, item, meta, usage, createdAt: new Date().toISOString() };
};

/** 渲染行:{ id, item, meta, usage, created_at },按 id 升序。 */
const listRows = (agentId, { afterId = 0 } = {}) => {
  const rows = getDb()
    .prepare("SELECT id, body, meta, usage, created_at FROM messages WHERE agent_id = ? AND id > ? ORDER BY id ASC")
    .all(String(agentId), Number(afterId) || 0);
  return rows.map((row) => ({
    id: row.id,
    item: JSON.parse(row.body),
    meta: row.meta ? JSON.parse(row.meta) : null,
    usage: row.usage ? JSON.parse(row.usage) : null,
    created_at: row.created_at,
  }));
};

/** 最近一次记录的用量(压缩水位用)。 */
const latestUsage = (agentId) => {
  const row = getDb()
    .prepare("SELECT usage FROM messages WHERE agent_id = ? AND usage IS NOT NULL ORDER BY id DESC LIMIT 1")
    .get(String(agentId));
  try { return row ? JSON.parse(row.usage) : null; } catch { return null; }
};

export { appendItem, listRows, latestUsage };
