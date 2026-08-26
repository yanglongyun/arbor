// @ts-nocheck
// OpenAI 兼容流式解析:逐 chunk 累积 content 和 tool_calls

const ensureToolCall = (toolCalls, index) => {
  if (!toolCalls[index]) {
    toolCalls[index] = {
      id: "",
      type: "function",
      function: { name: "", arguments: "" },
    };
  }
  return toolCalls[index];
};

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const mergeToolCallDelta = (target, delta) => {
  if (!isPlainObject(delta)) return target;
  for (const [key, value] of Object.entries(delta)) {
    if (value === undefined) continue;
    if (key === "index") continue;
    if (key === "function" && isPlainObject(value)) {
      const fn = target.function || { name: "", arguments: "" };
      if (typeof value.name === "string") fn.name = `${fn.name || ""}${value.name}`;
      if (typeof value.arguments === "string") fn.arguments = `${fn.arguments || ""}${value.arguments}`;
      for (const [fnKey, fnValue] of Object.entries(value)) {
        if (fnKey === "name" || fnKey === "arguments" || fnValue === undefined) continue;
        if (isPlainObject(fnValue)) {
          fn[fnKey] = { ...(isPlainObject(fn[fnKey]) ? fn[fnKey] : {}), ...fnValue };
        } else {
          fn[fnKey] = fnValue;
        }
      }
      target.function = fn;
      continue;
    }
    if (isPlainObject(value)) {
      target[key] = { ...(isPlainObject(target[key]) ? target[key] : {}), ...value };
      continue;
    }
    target[key] = value;
  }
  return target;
};

const openaiParser = {
  createState() {
    return { content: "", toolCalls: [], usage: null };
  },

  parseChunk(json, state, onDelta) {
    if (json?.usage) state.usage = json.usage;
    const choice = json?.choices?.[0];
    if (!choice) return;
    const delta = choice.delta || {};
    const text = typeof delta.content === "string" ? delta.content : "";
    if (text) {
      state.content += text;
      onDelta?.({ content: text });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = Number(tc?.index || 0);
        const target = ensureToolCall(state.toolCalls, idx);
        mergeToolCallDelta(target, tc);
      }
    }
  },

  toMessage(state) {
    if (state.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: state.content || null,
        tool_calls: state.toolCalls.filter(Boolean),
      };
    }
    return { role: "assistant", content: state.content };
  },
};

export { openaiParser };
