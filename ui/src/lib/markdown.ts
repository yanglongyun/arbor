import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

// 极简 sanitize:本地工具,主要防御意外 <script>/事件处理器
const sanitize = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");

// 渲染结果缓存:同一段内容只解析一次(聊天历史每条消息重复渲染、流式时高频重渲染都命中)。
const _cache = new Map<string, string>();
const CACHE_CAP = 800;

export const renderMarkdown = (md: string): string => {
  if (!md) return "";
  const key = String(md);
  const hit = _cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = sanitize(marked.parse(key, { async: false }) as string);
  } catch {
    html = key;
  }
  if (_cache.size >= CACHE_CAP) {
    const oldest = _cache.keys().next().value; // 简单 FIFO 淘汰
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, html);
  return html;
};
