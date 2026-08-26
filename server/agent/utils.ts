// @ts-nocheck
const TOOL_RESULT_MAX = 12000;

const truncateToolResult = (text, maxChars = TOOL_RESULT_MAX) => {
  const limit = Math.max(1000, Math.min(50000, Number(maxChars) || TOOL_RESULT_MAX));
  const s = String(text || "");
  if (s.length <= limit) return s;
  const head = s.slice(0, Math.floor(limit * 0.7));
  const tail = s.slice(-Math.floor(limit * 0.3));
  return `${head}\n... [truncated ${s.length - head.length - tail.length} chars] ...\n${tail}`;
};

export { truncateToolResult, TOOL_RESULT_MAX };
