// @ts-nocheck
// 不同 provider 的 header 差异收口

const buildLlmHeaders = (provider, apiUrl, apiKey) => {
  const headers = { "Content-Type": "application/json" };
  if (provider === "claude") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (String(apiUrl || "").includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "http://localhost:9506";
    headers["X-Title"] = "arbor";
  }
  return headers;
};

// 根据 apiUrl 自动猜 provider(如果没显式给)
const inferProvider = (apiUrl) => {
  const u = String(apiUrl || "");
  if (u.includes("api.deepseek.com"))               return "deepseek";
  if (u.includes("moonshot.cn") || u.includes("kimi.com")) return "kimi";
  if (u.includes("/gemini/"))                       return "gemini";
  if (u.includes("anthropic.com"))                  return "claude";
  return "openai";
};

export { buildLlmHeaders, inferProvider };
