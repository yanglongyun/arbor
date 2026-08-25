import { marked } from "marked";

// 净化渲染:正文来自模型、工具输出、被抓取的网页 —— 属不可信内容,却要经
// dangerouslySetInnerHTML 落进页面。在 marked 层掐断 XSS:
//   · 丢弃 markdown 里的原始 HTML(<script>/<img onerror> 一律不落地)
//   · 中和 javascript:/data:/vbscript: 链接与图片地址
// 正常 markdown(粗体/列表/代码/普通链接)不受影响。
// 从前用正则事后清洗 —— 清洗器和浏览器对 HTML 的理解不一致,迟早被绕过;
// 在渲染器层面不生成危险节点才是断根。
const renderer = new marked.Renderer();
renderer.html = () => "";

const badUrl = (url: unknown) => /^\s*(javascript|data|vbscript):/i.test(String(url || ""));

const baseLink = renderer.link.bind(renderer);
renderer.link = (token) => {
  if (badUrl(token.href)) token.href = "#";
  return baseLink(token);
};
const baseImage = renderer.image.bind(renderer);
renderer.image = (token) => {
  if (badUrl(token.href)) token.href = "";
  return baseImage(token);
};

marked.setOptions({ gfm: true, breaks: true, renderer });

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
    html = marked.parse(key, { async: false }) as string;
  } catch {
    html = "";
  }
  if (_cache.size >= CACHE_CAP) {
    const oldest = _cache.keys().next().value; // 简单 FIFO 淘汰
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, html);
  return html;
};
