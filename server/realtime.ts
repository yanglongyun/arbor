// @ts-nocheck
import WebSocket, { WebSocketServer } from "ws";
import { setBroadcaster } from "./bus.js";
import { runAgent, stopAgent } from "./service/agent.js";
import { appendMessage } from "./repo/messages.js";
import { resizeTerminal, startTerminal, stopAllTerminals, stopTerminal, writeTerminal } from "./terminals.js";

const clients = new Set();

const sendJson = (ws, payload) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
};

const broadcastAll = (payload) => {
  for (const c of clients) sendJson(c.ws, payload);
};

setBroadcaster(broadcastAll);

const handleConnection = (ws) => {
  const client = { ws, subs: new Set(), terminals: new Map() };
  clients.add(client);
  sendJson(ws, { type: "connected", ok: true });
  const sendToClient = (payload) => sendJson(ws, payload);

  ws.on("message", async (raw) => {
    let payload;
    try { payload = JSON.parse(String(raw)); }
    catch { sendJson(ws, { type: "error", error: "bad json" }); return; }

    const type = String(payload.type || "");
    const agentIdOf = () => String(payload.agentId || "");

    if (type === "subscribe") {
      const agentId = agentIdOf();
      client.subs.add(agentId);
      sendJson(ws, { type: "subscribed", agentId });
      return;
    }
    if (type === "unsubscribe") {
      client.subs.delete(agentIdOf());
      return;
    }
    if (type === "stop") {
      // 对任意 agentId 都生效(包括 spawn 出来的子智能体)
      stopAgent(agentIdOf());
      return;
    }
    if (type === "terminal_start") {
      startTerminal(client, payload, sendToClient);
      return;
    }
    if (type === "terminal_input") {
      writeTerminal(client, payload);
      return;
    }
    if (type === "terminal_resize") {
      resizeTerminal(client, payload);
      return;
    }
    if (type === "terminal_stop") {
      stopTerminal(client, payload.terminalId, sendToClient);
      return;
    }
    if (type === "send") {
      const agentId = agentIdOf();
      if (!agentId) {
        sendJson(ws, { type: "error", error: "missing agentId" });
        return;
      }
      client.subs.add(agentId);

      const prompt = String(payload.prompt || "").trim();
      if (prompt) {
        const msg = { role: "user", content: prompt };
        const meta = { kind: "message" };
        appendMessage(agentId, msg, meta);
        broadcastAll({ type: "input", agentId, kind: "message", message: msg, meta });
      }

      try {
        await runAgent(agentId);
        broadcastAll({ type: "done", agentId });
      } catch (error) {
        // 用户主动停止 = 一种"结束",也广播 end 让前端复位
        if (error?.name === "AbortError") {
          broadcastAll({ type: "aborted", agentId });
        } else {
          broadcastAll({ type: "error", agentId, code: "agent_failed", content: error.message });
        }
      }
      return;
    }

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
