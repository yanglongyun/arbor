// @ts-nocheck
// web_fetch:抓取一个已知 URL,去标签返回可读正文。
const stripHtml = (html) =>
  String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

const fetchWithTimeout = async (url, signal, ms = 15000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onOuterAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)" },
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
};

export const webFetchDef = {
  type: "function",
  name: "web_fetch",
  description: "抓取一个网页 URL,去掉标签返回可读正文(已截断)。用来读一个已知链接的正文。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么抓(界面会显示)" },
      url: { type: "string", description: "要抓取的 http(s) 链接" },
    },
    required: ["summary", "url"],
    additionalProperties: false,
  },
};

export const web_fetch = async ({ url }, ctx) => {
  const target = String(url || "").trim();
  if (!/^https?:\/\//.test(target)) return "error: url 必须以 http(s):// 开头";
  try {
    const response = await fetchWithTimeout(target, ctx.signal);
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const text = /html|xml/.test(contentType) || /^\s*</.test(body) ? stripHtml(body) : body;
    const max = 8000;
    return `[${response.status}] ${target}\n\n${text.slice(0, max)}${text.length > max ? `\n…(已截断,正文共 ${text.length} 字符)` : ""}`;
  } catch (e) {
    return `error: 抓取失败 ${e?.name === "AbortError" ? "超时或被停止" : e?.message}`;
  }
};
