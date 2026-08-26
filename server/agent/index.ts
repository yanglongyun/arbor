// @ts-nocheck
// 无状态 agent loop。
// 接收已组装好的 messages + 配置 + ctx(工具实现需要的外部能力),
// 跑 tool_call <-> tool_result 直到 final answer。
// 不碰任何 server 状态(节点/消息持久化由调用方负责,通过 onEvent 回调通知)。
// 默认走流式:每个 token 通过 onEvent({type:'message', content}) 回调。

import { callLm } from "./lm/index.js";
import { tools } from "./tools.js";
import { runTools } from "./runner.js";

const chat = async ({
  messages,
  model,
  apiUrl,
  apiKey,
  signal,
  onEvent = () => {},
  ctx,
  beforeModelCall = null,
  toolResultMaxChars = 12000,
}) => {
  const work = Array.isArray(messages) ? [...messages] : [];
  let round = 0;
  let lastUsage = null;

  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    round += 1;
    if (beforeModelCall) {
      const nextMessages = await beforeModelCall({ messages: work, lastUsage, round });
      if (Array.isArray(nextMessages)) {
        work.length = 0;
        work.push(...nextMessages);
      }
    }

    onEvent({ type: "start" });
    // 流式调用:每个 chunk 触发 message 事件
    const onDelta = (chunk) => {
      // chunk = { content?: string, reasoning?: string }
      if (chunk.content) onEvent({ type: "message", content: chunk.content, reasoning: chunk.reasoning || "" });
    };

    const { message, usage } = await callLm(
      apiUrl,
      apiKey,
      { model, messages: work, tools },
      { signal, onDelta },
    );

    if (usage) {
      lastUsage = usage;
      onEvent({ type: "usage", usage });
    }

    // tool calls
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const assistantMsg = {
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      };
      work.push(assistantMsg);
      onEvent({ type: "tool_calls", toolCalls: message.tool_calls });

      const toolMessages = await runTools(message.tool_calls, { signal, ctx, toolResultMaxChars });
      for (const tm of toolMessages) {
        work.push(tm);
      }
      onEvent({ type: "tool_results", results: toolMessages.map((message) => ({
        toolCallId: message.tool_call_id,
        content: message.content,
        message,
      })) });
      continue;
    }

    // final answer
    const text = message.content ?? "";
    const finalMsg = { role: "assistant", content: text };
    work.push(finalMsg);
    onEvent({ type: "done" });
    return { text, messages: work };
  }

};

export { chat };
