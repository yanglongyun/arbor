// @ts-nocheck
// SSE 流式调用:逐 chunk 喂给 parser,onDelta 实时回调
import { buildLlmHeaders } from "../common.js";
import { openaiParser } from "./parsers/openai.js";
import { deepseekParser } from "./parsers/deepseek.js";
import { kimiParser } from "./parsers/kimi.js";
import { geminiParser } from "./parsers/gemini.js";

const pickParser = (provider, apiUrl) => {
  const url = String(apiUrl || "");
  if (provider === "deepseek" || url.includes("api.deepseek.com")) return deepseekParser;
  if (provider === "kimi" || url.includes("moonshot.cn") || url.includes("kimi.com")) return kimiParser;
  if (provider === "gemini" || url.includes("/gemini/")) return geminiParser;
  return openaiParser;
};

const safeJson = (raw) => { try { return JSON.parse(raw); } catch { return null; } };

const callLlmStream = async (provider, apiUrl, apiKey, payload, { signal, onDelta } = {}) => {
  const parser = pickParser(provider, apiUrl);
  const state = parser.createState();
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: buildLlmHeaders(provider, apiUrl, apiKey),
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM ${res.status}: ${text}`);
  }
  if (!res.body) throw new Error("LLM stream body is empty");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep >= 0) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf("\n\n");
        const lines = event.split("\n").map((l) => l.trim()).filter(Boolean);
        const dataLines = lines
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (!dataLines.length) continue;
        const raw = dataLines.join("\n");
        if (!raw || raw === "[DONE]") continue;
        const json = safeJson(raw);
        if (json) parser.parseChunk(json, state, onDelta);
      }
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }

  const message = parser.toMessage(state);
  return { message, usage: state.usage || null };
};

export { callLlmStream };
