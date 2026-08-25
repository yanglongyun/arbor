// 直播 reducer:一块面板一份,事件按 agentId 认领(广播是全量的)。
// 行对象原地修改,改完由调用方 bump 触发重渲染。
import { EVENTS } from "../../../../server/shared/events";
import { mkKey, toolRow, renderRows, type Row } from "./thread";
import type { MessageRow } from "../../api";

export interface StreamPorts {
  agentId: string;
  getRows: () => Row[];
  pushRow: (row: Row) => Row;
  setBusy: (busy: boolean) => void;
  /** 终局后的对账刷新:补齐服务端事实(行 id、真实落库内容)。 */
  refresh: () => void;
  bump: () => void;
}

export function setupStream(ports: StreamPorts) {
  const { agentId, getRows, pushRow, setBusy, refresh, bump } = ports;
  let streamingKey = "";

  const find = (key: string) => getRows().find((row) => row.key === key);

  const closeStreaming = () => {
    if (!streamingKey) return;
    const row = find(streamingKey);
    if (row) row.streaming = false;
    streamingKey = "";
  };

  const streamingRow = (): Row => {
    if (streamingKey) {
      const existing = find(streamingKey);
      if (existing) return existing;
    }
    const row = pushRow({ key: mkKey("a"), kind: "assistant", content: "", reasoning: "", streaming: true, at: Date.now() });
    streamingKey = row.key;
    return row;
  };

  const completeCall = (callId: string, result: string) => {
    const rows = getRows();
    let target: Row | undefined;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].kind === "tool" && rows[i].callId === callId) { target = rows[i]; break; }
    }
    if (!target) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].kind === "tool" && rows[i].status !== "done") { target = rows[i]; break; }
      }
    }
    if (!target) return;
    target.result = result;
    target.status = "done";
  };

  /** 终局时把还挂着的工具行收掉 —— 停止/出错后等不到 output 事件,不收就永远「执行中」。 */
  const settleCalls = () => {
    for (const row of getRows()) {
      if (row.kind === "tool" && row.status !== "done") row.status = "done";
    }
  };

  const onEvent = (payload: any) => {
    if (String(payload.agentId || "") !== agentId) return;

    switch (payload.type) {
      case EVENTS.START:
        setBusy(true);
        closeStreaming();
        break;

      case EVENTS.INPUT: {
        // 新消息进邮箱:用户消息(可能来自别的窗口)、agent 来信/回信、压缩摘要、系统留痕。
        // 本地乐观行靠 refresh 对账;这里只把「别处来的」补进画面 —— 判定:
        // 行 id 都来自服务端,直接按渲染映射追加即可(自己发的那条已由面板本地推入,
        // 面板在推入时打了 localEcho 标记,收到 INPUT 时跳过一次)。
        const consumed = consumeLocalEcho(payload.row);
        if (consumed) break;
        const mapped = renderRows([payload.row as MessageRow]);
        for (const row of mapped) pushRow(row);
        break;
      }

      case EVENTS.REASONING: {
        const row = streamingRow();
        row.reasoning = (row.reasoning || "") + String(payload.content || "");
        break;
      }
      case EVENTS.DELTA: {
        const row = streamingRow();
        row.content = (row.content || "") + String(payload.content || "");
        break;
      }

      case EVENTS.CALL_STARTED:
        // 模型转去吐工具参数了:正文行到此为止,不收会把等待动画压住
        closeStreaming();
        break;

      case EVENTS.CALLS: {
        closeStreaming();
        for (const call of payload.calls || []) pushRow({ ...toolRow(call, "running"), at: Date.now() });
        break;
      }
      case EVENTS.CALL_OUTPUT:
        completeCall(String(payload.callId || ""), typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result));
        break;

      case EVENTS.COMPACT_START:
        closeStreaming();
        pushRow({ key: mkKey("c"), kind: "chip", code: "compacting", content: "正在压缩早期对话…", at: Date.now() });
        break;
      case EVENTS.COMPACT_DONE: {
        const rows = getRows();
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].kind === "chip" && rows[i].code === "compacting") {
            rows[i].code = "compacted";
            rows[i].content = "已压缩早期对话";
            break;
          }
        }
        break;
      }

      case EVENTS.DONE:
        closeStreaming();
        settleCalls();
        setBusy(false);
        refresh(); // 对账:补齐服务端事实
        break;

      case EVENTS.ABORTED:
        closeStreaming();
        settleCalls();
        setBusy(false);
        // [stopped] 留痕由服务端落库并走 INPUT 事件进画面,这里不重复推
        break;

      case EVENTS.ERROR:
        closeStreaming();
        settleCalls();
        setBusy(false);
        break;

      default:
        return;
    }
    bump();
  };

  // ── 本地回声:自己发的消息已乐观入画,服务端广播回来那份跳过一次 ──
  let localEchoes = 0;
  const armLocalEcho = () => { localEchoes += 1; };
  const consumeLocalEcho = (row: any) => {
    if (localEchoes <= 0) return false;
    const kind = String(row?.meta?.kind || "");
    if (kind !== "message") return false; // 只有用户手发的消息会乐观入画
    localEchoes -= 1;
    return true;
  };

  return { onEvent, armLocalEcho, close: closeStreaming };
}
