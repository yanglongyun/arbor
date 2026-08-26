// @ts-nocheck
// WebSocket:唯一的双向通道。
//   - send:落库用户消息 → 立即返回;轮子在 runs 层后台转,事件广播、按 agentId 认领。
//     从前 send 在这里 await 整轮 —— 新模型下运行不绑在任何一次收发上。
//   - stop:停任意 agentId(包括 spawn 出来的子智能体)。
//   - terminal_*:终端多路复用(必须双向,ws 因此是通道的形态)。
import WebSocket, { WebSocketServer } from "ws";
import { setBroadcaster } from "./bus.js";
import { EVENTS } from "./shared/events.js";
import { runAgent, stopAgent } from "./runs/index.js";
import { appendItem } from "./repo/messages.js";
import { touchAgent } from "./repo/agents.js";
import { emit } from "./bus.js";
import { resizeTerminal, startTerminal, stopAllTerminals, stopTerminal, writeTerminal } from "./terminals.js";

const clients = new Set();

const sendJson = (ws, payload) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
};

const broadcastAll = (payload) => {
  for (const client of clients) sendJson(client.ws, payload);
};

setBroadcaster(broadcastAll);

const handleConnection = (ws) => {
  const client = { ws, terminals: new Map() };
  clients.add(client);
  sendJson(ws, { type: "connected", ok: true });
  const sendToClient = (payload) => sendJson(ws, payload);

  ws.on("message", async (raw) => {
    let payload;
    try { payload = JSON.parse(String(raw)); }
    catch { sendJson(ws, { type: "error", error: "bad json" }); return; }

    const type = String(payload.type || "");
    const agentId = String(payload.agentId || "");

    if (type === "stop") {
      stopAgent(agentId);
      return;
    }
    if (type === "terminal_start") { startTerminal(client, payload, sendToClient); return; }
    if (type === "terminal_input") { writeTerminal(client, payload); return; }
    if (type === "terminal_resize") { resizeTerminal(client, payload); return; }
    if (type === "terminal_stop") { stopTerminal(client, payload.terminalId, sendToClient); return; }

    if (type === "send") {
      if (!agentId) { sendJson(ws, { type: "error", error: "missing agentId" }); return; }
      const prompt = String(payload.prompt || "").trim();
      if (prompt) {
        const row = appendItem(agentId, { role: "user", content: prompt }, { meta: { kind: "message" } });
        touchAgent(agentId); // 浮到最近组顶部
        emit({ type: EVENTS.INPUT, agentId, row });
      }
      // 立即返回;终局事件(done/aborted/error)由 runs 层广播。
      // 这里只兜运行前的失败(正在运行/没配模型),它们发生在任何广播之前。
      runAgent(agentId).catch((error) => {
        if (error?.name === "AbortError") return;
        if (/already running/i.test(error?.message || "")) return; // 邮箱已收到消息,跑完这轮自然会带上
        emit({ type: EVENTS.ERROR, agentId, message: String(error?.message || error) });
      });
      return;
    }

    // subscribe/unsubscribe 是旧协议的空操作:广播本就全量,界面按 agentId 认领
    if (type === "subscribe" || type === "unsubscribe") return;

    sendJson(ws, { type: "error", error: `unknown: ${type}` });
  });

  ws.on("close", () => {
    stopAllTerminals(client);
    clients.delete(client);
  });
};

const attachWs = (server) => {
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", handleConnection);
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/api/ws") { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
};

export { attachWs };
