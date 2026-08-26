// @ts-nocheck
// HTTP 层:只管解析请求 / 拼响应,业务都委托给 service。
import fs from "fs";
import nodePath from "path";
import { execFile } from "child_process";
import * as tree from "../service/tree.js";
import { listMessages } from "../repo/messages.js";
import { listCalls } from "../repo/calls.js";
import { getSettings, saveSettings } from "../repo/settings.js";
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitDiff,
  gitDiscard,
  gitInit,
  gitRemoteAction,
  gitStage,
  gitUnstage,
  listGitRepositories,
  repositoryStatusForPath,
} from "../repo/git.js";
import { getProcess, listProcesses, startProcess, stopProcess } from "../processes.js";
import { pickDirectory } from "../directoryPicker.js";

const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const json = (res, code, data) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2) + "\n");
};

// 静态文件 mime —— 给 /api/fs(按路径服务,供 HTML 预览解析相对资源)和 /api/file/raw 复用
const MIME = {
  ".html": "text/html", ".htm": "text/html",
  ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".bmp": "image/bmp", ".avif": "image/avif", ".pdf": "application/pdf",
  ".txt": "text/plain", ".md": "text/plain",
};
const serveFile = (res, abs) => {
  const type = MIME[nodePath.extname(abs).toLowerCase()] || "application/octet-stream";
  const textish = type.startsWith("text/") || type.endsWith("json") || type.endsWith("svg+xml");
  res.writeHead(200, {
    "Content-Type": textish ? `${type}; charset=utf-8` : type,
    "Cache-Control": "no-cache",
  });
  res.end(fs.readFileSync(abs));
};

const handleApi = async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method;

  try {
    if (path === "/health") return json(res, 200, { ok: true });

    // ---- tree(统一树:文件夹 / 智能体 / 文件)----
    if (path === "/api/tree") {
      if (method === "GET") {
        return json(res, 200, { ok: true, items: tree.listChildren(url.searchParams.get("parentId")) });
      }
      if (method === "POST") {
        const body = await parseBody(req);
        try {
          return json(res, 201, { ok: true, item: tree.create(body) });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
      if (method === "PATCH") {
        const id = url.searchParams.get("id");
        const body = await parseBody(req);
        try {
          return json(res, 200, { ok: true, item: tree.update(id, body) });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
      if (method === "DELETE") {
        try {
          tree.remove(url.searchParams.get("id"));
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
    }

    // ---- workspaces(root folders)----
    if (path === "/api/workspaces/pick" && method === "POST") {
      try {
        return json(res, 200, { ok: true, path: await pickDirectory() });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }

    if (path === "/api/workspaces") {
      if (method === "GET") return json(res, 200, { ok: true, workspaces: tree.listWorkspaces() });
      if (method === "POST") {
        const body = await parseBody(req);
        try {
          return json(res, 201, { ok: true, item: tree.addWorkspace(body) });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
      if (method === "DELETE") {
        try {
          return json(res, 200, { ok: true, workspace: tree.removeWorkspace(url.searchParams.get("id")) });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
    }

    if (path === "/api/tree/get") {
      const item = tree.getItem(url.searchParams.get("id"));
      if (!item) return json(res, 404, { ok: false, error: "not found" });
      return json(res, 200, { ok: true, item });
    }

    // 全树扁平列表(⌘P 快速打开)
    if (path === "/api/tree/all" && method === "GET") {
      return json(res, 200, { ok: true, items: tree.listAll() });
    }

    // 标记智能体已读
    if (path === "/api/tree/read" && method === "POST") {
      return json(res, 200, { ok: true, item: tree.markRead(url.searchParams.get("id")) });
    }

    // 全局内容搜索(⌘⇧F):grep 真实文件
    if (path === "/api/search" && method === "GET") {
      return json(res, 200, { ok: true, results: tree.search(url.searchParams.get("q") || "") });
    }

    // 原始文件流(图片/PDF 等二进制预览用)
    if (path === "/api/file/raw" && method === "GET") {
      const abs = tree.fileRawAbs(url.searchParams.get("id"));
      if (!abs) return json(res, 404, { ok: false, error: "not found" });
      const RAW_MIME = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
        ".ico": "image/x-icon", ".bmp": "image/bmp", ".avif": "image/avif",
        ".pdf": "application/pdf",
      };
      const ext = nodePath.extname(abs).toLowerCase();
      res.writeHead(200, {
        "Content-Type": RAW_MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(fs.readFileSync(abs));
      return;
    }

    if (path === "/api/ancestry") {
      return json(res, 200, { ok: true, ancestry: tree.ancestry(url.searchParams.get("id")) });
    }

    // ---- messages(某个智能体的邮箱)----
    if (path === "/api/messages" && method === "GET") {
      return json(res, 200, { ok: true, messages: listMessages(url.searchParams.get("agentId")) });
    }

    // ---- calls ----
    if (path === "/api/calls" && method === "GET") {
      const callerId = url.searchParams.get("callerId") || undefined;
      const calleeId = url.searchParams.get("calleeId") || undefined;
      const status = url.searchParams.get("status") || undefined;
      const titleOf = (id) => { if (!id) return null; try { const it = tree.getItem(id); return it ? it.title : null; } catch { return null; } };
      const calls = listCalls({ callerId, calleeId, status }).map((c) => ({
        ...c, callerTitle: titleOf(c.caller_id), calleeTitle: titleOf(c.callee_id),
      }));
      return json(res, 200, { ok: true, calls });
    }

    // ---- git ----
    if (path === "/api/git/status" && method === "GET") {
      return json(res, 200, { ok: true, repositories: listGitRepositories() });
    }
    if (path === "/api/git/repository" && method === "GET") {
      return json(res, 200, { ok: true, repository: repositoryStatusForPath(url.searchParams.get("path")) });
    }
    if (path === "/api/git/diff" && method === "GET") {
      return json(res, 200, {
        ok: true,
        diff: gitDiff({
          root: url.searchParams.get("root"),
          filePath: url.searchParams.get("path"),
          staged: url.searchParams.get("staged") === "1",
        }),
      });
    }
    if (path === "/api/git/branches" && method === "GET") {
      return json(res, 200, { ok: true, ...gitBranches(url.searchParams.get("root")) });
    }
    if (path === "/api/git/stage" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, repository: gitStage(body) });
    }
    if (path === "/api/git/unstage" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, repository: gitUnstage(body) });
    }
    if (path === "/api/git/discard" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, repository: gitDiscard(body) });
    }
    if (path === "/api/git/commit" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, ...gitCommit(body) });
    }
    if (path === "/api/git/remote" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, ...gitRemoteAction(body) });
    }
    if (path === "/api/git/checkout" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, ...gitCheckout(body) });
    }
    if (path === "/api/git/init" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, ...gitInit(body) });
    }

    // ---- settings ----
    if (path === "/api/settings") {
      if (method === "GET") return json(res, 200, { ok: true, settings: getSettings() });
      if (method === "POST") {
        const body = await parseBody(req);
        return json(res, 200, { ok: true, settings: saveSettings(body) });
      }
    }

    // ---- background processes / preview ----
    if (path === "/api/processes") {
      if (method === "GET") return json(res, 200, { ok: true, processes: listProcesses() });
      if (method === "POST") {
        const body = await parseBody(req);
        try {
          return json(res, 201, { ok: true, process: startProcess(body) });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
    }

    if (path === "/api/processes/get" && method === "GET") {
      const proc = getProcess(url.searchParams.get("id"));
      if (!proc) return json(res, 404, { ok: false, error: "not found" });
      return json(res, 200, { ok: true, process: proc });
    }

    if (path === "/api/processes/stop" && method === "POST") {
      try {
        return json(res, 200, { ok: true, process: stopProcess(url.searchParams.get("id")) });
      } catch (error) {
        return json(res, 404, { ok: false, error: error.message });
      }
    }

    // 在系统文件管理器里显示该节点(macOS Finder / Windows 资源管理器 / Linux 文件管理器)
    if (path === "/api/reveal" && method === "POST") {
      const abs = tree.pathForId(url.searchParams.get("id"));
      if (!abs) return json(res, 404, { ok: false, error: "not found" });
      const plt = process.platform;
      let cmd, args;
      if (plt === "darwin") { cmd = "open"; args = ["-R", abs]; }
      else if (plt === "win32") { cmd = "explorer"; args = [`/select,${abs}`]; }
      else { cmd = "xdg-open"; args = [nodePath.dirname(abs)]; }
      execFile(cmd, args, () => {}); // 部分平台(如 explorer)成功也返回非 0,忽略
      return json(res, 200, { ok: true, path: abs });
    }

    // 按路径服务工作区内文件(HTML 预览用 —— iframe 在 /api/fs/<dir>/index.html,
    // 相对的 styles.css 自然解析到 /api/fs/<dir>/styles.css)。仅限工作区根内的文件。
    if (path.startsWith("/api/fs/") && method === "GET") {
      let abs;
      try { abs = decodeURIComponent(path.slice("/api/fs".length)); }
      catch { abs = path.slice("/api/fs".length); }
      const real = tree.fileRawAbs(abs);
      if (!real) return json(res, 404, { ok: false, error: "not found" });
      serveFile(res, real);
      return;
    }

    if (path.startsWith("/api/")) return json(res, 404, { ok: false, error: "Not found" });
    return null;
  } catch (error) {
    json(res, 500, { ok: false, error: error.message });
  }
};

export { handleApi };
