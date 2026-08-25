// @ts-nocheck
// 文件三件套:有界读(带行号)/ 精确替换 / 带护栏写。
// 相对路径相对智能体的工作目录(ctx.cwd)解析,和 shell 一致。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";

const resolvePath = (p, ctx) => {
  const rel = String(p || "");
  if (!rel) return ctx?.cwd || process.cwd();
  return isAbsolute(rel) ? rel : resolve(ctx?.cwd || process.cwd(), rel);
};

export const readFileDef = {
  type: "function",
  name: "read_file",
  description:
    "读取一个文本文件,返回带行号的内容(便于随后用 edit_file 精确定位)。大文件用 offset/limit 分页。" +
    "相对路径相对你的工作目录。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么读(界面会显示)" },
      path: { type: "string", description: "文件路径(相对你的目录或绝对路径)" },
      offset: { type: "number", description: "可选:从第几行开始读(1 起)" },
      limit: { type: "number", description: "可选:读多少行(默认 2000,上限 2000)" },
    },
    required: ["summary", "path"],
    additionalProperties: false,
  },
};

export const read_file = ({ path: p, offset, limit }, ctx) => {
  const abs = resolvePath(p, ctx);
  let stat;
  try { stat = statSync(abs); } catch { return `error: 文件不存在: ${p}`; }
  if (stat.isDirectory()) return `error: ${p} 是目录(列目录用 shell 的 ls)`;
  if (stat.size > 5_000_000) return `error: 文件过大(${stat.size} 字节),请用 shell 处理`;
  let buf;
  try { buf = readFileSync(abs); } catch (e) { return `error: ${e.message}`; }
  if (buf.subarray(0, 8192).includes(0)) return `(二进制文件,${stat.size} 字节,无法按文本读)`;
  const lines = buf.toString("utf8").split("\n");
  const start = Math.max(1, Number(offset) || 1);
  const count = Math.min(Number(limit) || 2000, 2000);
  const slice = lines.slice(start - 1, start - 1 + count);
  if (!slice.length) return `(超出文件范围,共 ${lines.length} 行)`;
  const numbered = slice.map((line, index) => `${String(start + index).padStart(5)}\t${line}`).join("\n");
  const rest = lines.length - (start - 1 + count);
  return numbered + (rest > 0 ? `\n… (还有 ${rest} 行,用 offset=${start + count} 继续读)` : "");
};

export const editFileDef = {
  type: "function",
  name: "edit_file",
  description:
    "精确替换文件里的一段文本:把 old 替换成 new。old 必须在文件里唯一匹配(否则报错,请带更长上下文)。" +
    "改文件首选 —— 比 shell sed / 重写整文件可靠且省 token。需替换多处可设 replace_all。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么改(界面会显示)" },
      path: { type: "string", description: "文件路径" },
      old: { type: "string", description: "要被替换的原文(需在文件中唯一)" },
      new: { type: "string", description: "替换成的新文本" },
      replace_all: { type: "boolean", description: "可选:替换所有匹配(默认只替换唯一一处)" },
    },
    required: ["summary", "path", "old", "new"],
    additionalProperties: false,
  },
};

export const edit_file = ({ path: p, old, new: next, replace_all }, ctx) => {
  if (old == null || old === "") return "error: old(要替换的原文)不能为空";
  const newStr = next ?? "";
  const abs = resolvePath(p, ctx);
  let content;
  try { content = readFileSync(abs, "utf8"); } catch { return `error: 读不到文件: ${p}`; }
  const occurrences = content.split(old).length - 1;
  if (occurrences === 0) return "error: 没找到要替换的内容(old 在文件里不存在)。先用 read_file 确认原文。";
  if (occurrences > 1 && !replace_all) return `error: old 出现了 ${occurrences} 次,不唯一。请带上更长、唯一的上下文,或设 replace_all=true。`;
  const updated = replace_all ? content.split(old).join(String(newStr)) : content.replace(old, String(newStr));
  try { writeFileSync(abs, updated); } catch (e) { return `error: 写回失败 ${e.message}`; }
  ctx.emit?.({ type: "tree_changed", reason: "edit_file" });
  return `已编辑 ${p}(替换 ${replace_all ? occurrences : 1} 处)`;
};

export const writeFileDef = {
  type: "function",
  name: "write_file",
  description:
    "把 content 写入文件(不存在则创建,父目录自动创建;存在则覆盖)。新建文件或整体重写时用它;只改局部请用 edit_file。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么写(界面会显示)" },
      path: { type: "string", description: "文件路径" },
      content: { type: "string", description: "文件内容" },
    },
    required: ["summary", "path", "content"],
    additionalProperties: false,
  },
};

export const write_file = ({ path: p, content }, ctx) => {
  if (!p) return "error: path 不能为空";
  const abs = resolvePath(p, ctx);
  const existed = existsSync(abs);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content != null ? String(content) : "");
  } catch (e) { return `error: ${e.message}`; }
  ctx.emit?.({ type: "tree_changed", reason: "write_file" });
  const bytes = Buffer.byteLength(content != null ? String(content) : "");
  return `${existed ? "已覆盖" : "已创建"} ${p}(${bytes} 字节)`;
};
