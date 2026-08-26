// @ts-nocheck
// 非流式调用:整应答一次返回
import { buildLlmHeaders } from "./common.js";

const callLlmRegular = async (provider, apiUrl, apiKey, payload, { signal } = {}) => {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: buildLlmHeaders(provider, apiUrl, apiKey),
    body: JSON.stringify({ ...payload, stream: false }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM ${res.status}: ${text}`);
  }
  const json = await res.json();
  const message = json?.choices?.[0]?.message;
  if (!message) throw new Error("LLM response missing choices[0].message");
  return { message, usage: json?.usage || null };
};

export { callLlmRegular };
