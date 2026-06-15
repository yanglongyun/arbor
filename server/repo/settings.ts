// @ts-nocheck
import { getDb } from "../db.js";

const DEFAULTS = {
  apiUrl: "",
  apiKey: "",
  model: "",
  compressThreshold: "12000",
  compactPrompt: "",
  toolResultMaxChars: "12000",
  // 默认人格(无自定义 system 的智能体的兜底)。工具清单 / 身份 / 协作规则由 buildSystem 每次注入,
  // 这里只放一段简洁、务实的基调,避免和注入内容重复或过时。
  system:
    "你是 Arbor 里的一个智能体,以一个节点的形式活在用户的工作树里。\n" +
    "务实、简洁,把事情真正做完 —— 需要建文件、跑命令、查资料,或叫上别的智能体协作时,直接用你的工具去做,而不是只在嘴上说。\n" +
    "完成后给一个清楚的最终回复;工具的细节不必复述给用户。",
};

const getSettings = () => {
  const rows = getDb().prepare("SELECT key, value FROM settings").all();
  const settings = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in DEFAULTS) settings[row.key] = row.value;
  }
  return settings;
};

const saveSettings = (patch = {}) => {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    if (value === undefined || value === null) continue;
    stmt.run(key, String(value));
  }
  return getSettings();
};

export { getSettings, saveSettings, DEFAULTS };
