// @ts-nocheck
import http from "http";
import { handleApi } from "./api/index.js";
import { attachWs } from "./realtime.js";
import { serve } from "./static.js";
import { startWatcher } from "./watcher.js";
import { migrateOnBoot } from "./service/agents.js";

const startServer = async (port = 9506) =>
  new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const result = await handleApi(req, res);
      if (result === null) {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        serve(res, url.pathname);
      }
    });
    attachWs(server);
    server.listen(port, "127.0.0.1", () => {
      migrateOnBoot(); // 历史 .agent.json → SQLite,用户目录从此干净
      startWatcher(); // 工作区文件监听:磁盘上的任何变化 → 树自动刷新
      console.log(`Arbor running on http://127.0.0.1:${port}`);
      resolve(server);
    });
    server.on("error", reject);
  });

export { startServer };
