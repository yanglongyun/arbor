// @ts-nocheck
// 对话事件契约 —— 服务端广播、界面认领,跨进程的字符串只写这一份。
// 全部带 agentId;界面按 agentId 认领,不是自己那条线的直接忽略。
// (树/进程/终端等既有事件名不在此列,维持原样:tree_changed / call_changed /
//  process_changed / terminal_* / connected。)
export const EVENTS = Object.freeze({
  /** 一轮开始跑了。 */
  START: "conversation.start",
  /** 思考流增量:{ content }。 */
  REASONING: "conversation.reasoning",
  /** 正文流增量:{ content }。 */
  DELTA: "conversation.delta",
  /** 模型转去吐工具参数了,正文行到此为止。 */
  CALL_STARTED: "conversation.callStarted",
  /** 一批工具调用已就绪:{ calls: [{ callId, name, args }] }。 */
  CALLS: "conversation.calls",
  /** 某次工具调用出结果:{ callId, result }。 */
  CALL_OUTPUT: "conversation.callOutput",
  /** 上下文压缩:开始 / 结束。 */
  COMPACT_START: "conversation.compactStart",
  COMPACT_DONE: "conversation.compactDone",
  /** 新消息进邮箱(用户消息 / agent 来信 / 回信 / 压缩摘要):{ row }。 */
  INPUT: "conversation.input",
  /** 终局三态。ERROR 带 { message }。 */
  DONE: "conversation.done",
  ABORTED: "conversation.aborted",
  ERROR: "conversation.error",
});
