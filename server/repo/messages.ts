// @ts-nocheck
import { getDb } from "../db.js";

const appendMessage = (agentId, message, meta = null, usage = null) => {
  const result = getDb()
    .prepare("INSERT INTO messages (agent_id, body, meta, usage) VALUES (?, ?, ?, ?)")
    .run(String(agentId), JSON.stringify(message), meta ? JSON.stringify(meta) : null, usage ? JSON.stringify(usage) : null);
  return Number(result.lastInsertRowid);
};

const listMessages = (agentId) => {
  const rows = getDb()
    .prepare("SELECT id, body, meta, usage FROM messages WHERE agent_id = ? ORDER BY id ASC")
    .all(String(agentId));
  return rows.map((row) => ({
    ...JSON.parse(row.body),
    _id: row.id,
    ...(row.meta ? { _meta: JSON.parse(row.meta) } : {}),
    ...(row.usage ? { usage: JSON.parse(row.usage) } : {}),
  }));
};

const historyFor = (agentId) =>
  listMessages(agentId).map(({ _id, _meta, usage, ...rest }) => rest);

const rowsFor = (agentId) => listMessages(agentId).map((message) => ({
  id: message._id,
  message: (() => {
    const { _id, _meta, usage, ...rest } = message;
    return rest;
  })(),
  meta: message._meta || null,
  usage: message.usage || null,
}));

export { appendMessage, listMessages, historyFor, rowsFor };
