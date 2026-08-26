// @ts-nocheck
// 网站收藏:侧栏「网站」页的数据。就是一张链接表,打开动作全在界面(<webview> 标签)。
import { randomUUID } from "crypto";
import { getDb } from "../db.js";
import { emit } from "../bus.js";

const changed = () => emit({ type: "sites_changed" });

const normalizeUrl = (raw) => {
  const value = String(raw || "").trim();
  if (!value) throw new Error("url is required");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withScheme); // 非法直接抛
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("只支持 http(s) 链接");
  return parsed.toString();
};

const list = () => getDb().prepare("SELECT * FROM sites ORDER BY created_at, rowid").all();

const create = ({ url, title } = {}) => {
  const normalized = normalizeUrl(url);
  const id = randomUUID();
  const name = String(title || "").trim() || new URL(normalized).host;
  getDb().prepare("INSERT INTO sites (id, title, url) VALUES (?, ?, ?)").run(id, name, normalized);
  changed();
  return getDb().prepare("SELECT * FROM sites WHERE id = ?").get(id);
};

const update = (id, { title, url } = {}) => {
  const db = getDb();
  if (title !== undefined) db.prepare("UPDATE sites SET title = ? WHERE id = ?").run(String(title || "").trim() || "未命名网站", String(id));
  if (url !== undefined) db.prepare("UPDATE sites SET url = ? WHERE id = ?").run(normalizeUrl(url), String(id));
  changed();
  return db.prepare("SELECT * FROM sites WHERE id = ?").get(String(id));
};

const remove = (id) => {
  const ok = getDb().prepare("DELETE FROM sites WHERE id = ?").run(String(id)).changes > 0;
  changed();
  return ok;
};

export { list, create, update, remove };
