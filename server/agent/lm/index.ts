// @ts-nocheck
// LLM 入口。
// 有 onDelta → 走流式;没有 → 走非流式。
// provider 没显式给就按 apiUrl 自动猜。
import { inferProvider } from "./common.js";
import { callLlmRegular } from "./regular.js";
import { callLlmStream } from "./stream/index.js";

const callLm = async (apiUrl, apiKey, payload, { signal, onDelta, provider } = {}) => {
  const prov = provider || inferProvider(apiUrl);
  if (onDelta) {
    return await callLlmStream(prov, apiUrl, apiKey, payload, { signal, onDelta });
  }
  return await callLlmRegular(prov, apiUrl, apiKey, payload, { signal });
};

export { callLm };
