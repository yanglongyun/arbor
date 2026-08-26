// @ts-nocheck
import * as functions from "./functions.js";
import { truncateToolResult } from "./utils.js";

const runTools = async (toolCalls, { signal, ctx, toolResultMaxChars = 12000 }) => {
  const out = [];
  for (const tc of toolCalls) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const name = tc.function.name;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); }
    catch { args = {}; }

    let content;
    try {
      const fn = functions[name];
      if (!fn) throw new Error(`unknown tool: ${name}`);
      content = await fn(args, { ...ctx, signal });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      content = `tool error: ${error.message}`;
    }
    const text = typeof content === "string" ? content : JSON.stringify(content);
    out.push({
      role: "tool",
      tool_call_id: tc.id,
      content: truncateToolResult(text, toolResultMaxChars),
    });
  }
  return out;
};

export { runTools };
