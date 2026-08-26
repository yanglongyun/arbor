// Electron 壳:拉起本地服务(系统 node 跑 esbuild 单文件),窗口指向 127.0.0.1。
//
// 为什么用系统 node 而不是 Electron 自带的 Node:node-pty 是原生模块,按系统 node
// 的 ABI 编译;塞进 Electron 的 Node 要 electron-rebuild 整一轮。开发期直接用系统
// node 零 ABI 纠纷;正式打包时再换成随包 node + rebuild(见 dev/ 版本文档)。
import { app, BrowserWindow, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let child = null;
let quitting = false;

/** 开发态:仓库就是家。打包态:代码在只读资源区,数据在 userData。 */
const layout = () => {
  if (!app.isPackaged) {
    return {
      nodeBin: "node",
      serverEntry: join(ROOT, "dist/server.mjs"),
      cwd: ROOT,
      env: { ARBOR_HOME: ROOT },
    };
  }
  const res = process.resourcesPath;
  return {
    nodeBin: join(res, "core/bin/node"),
    serverEntry: join(res, "core/server.mjs"),
    cwd: join(res, "core"), // node-pty 从 core/node_modules 解析
    env: {
      ARBOR_HOME: app.getPath("userData"), // database/ 落在这里(macOS 惯例:应用数据进 Application Support)
      // 工作区是用户要在 Finder 里摸的真实文件树 —— 按「用户文档」惯例放 Documents,
      // 不埋进 Library(对照 Obsidian vault / Logseq graph 的默认位置)
      ARBOR_WORKSPACES: join(app.getPath("documents"), "Arbor"),
      ARBOR_UI_DIST: join(res, "core/ui"),
    },
  };
};

/** 找一个空闲端口;显式给了 ARBOR_PORT 就用它(比如想连已在跑的 dev 服务)。 */
const pickPort = () => new Promise((resolve, reject) => {
  const fixed = Number(process.env.ARBOR_PORT) || 0;
  if (fixed) { resolve(fixed); return; }
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});

/** GUI 场景(Finder 启动)PATH 很瘦,补上常见的 node 安装位置(开发态用 PATH 找 node)。 */
const spawnEnv = (port, extra) => ({
  ...process.env,
  PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":"),
  ARBOR_PORT: String(port),
  ...extra,
});

const waitHealthy = async (port, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch { /* 还没起来 */ }
    if (child && child.exitCode !== null) throw new Error(`服务进程退出(code ${child.exitCode})`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("等待本地服务超时(15s)");
};

const startServer = async (port) => {
  const { nodeBin, serverEntry, cwd, env } = layout();
  child = spawn(nodeBin, [serverEntry], {
    cwd,
    env: spawnEnv(port, env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  child.on("exit", (code) => {
    child = null;
    if (!quitting) {
      dialog.showErrorBox("Arbor", `本地服务意外退出(code ${code})。`);
      app.quit();
    }
  });
  await waitHealthy(port);
};

const createWindow = (port) => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#ffffff",
    title: "Arbor",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // 网页标签:界面里的 <webview>,真会话真登录态
    },
  });
  // 外部链接去系统浏览器,别在壳里迷路
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.loadURL(`http://127.0.0.1:${port}`);
  return win;
};

// 网页标签里的 window.open / target=_blank:留在原地导航,不许弹窗乱飞
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) contents.loadURL(url);
    return { action: "deny" };
  });
});

app.whenReady().then(async () => {
  try {
    const port = await pickPort();
    await startServer(port);
    createWindow(port);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  } catch (error) {
    dialog.showErrorBox("Arbor 启动失败", String(error?.message || error));
    app.quit();
  }
});

const stopChild = () => {
  quitting = true;
  if (child) {
    try { child.kill("SIGTERM"); } catch { /* 已退出 */ }
    child = null;
  }
};

app.on("before-quit", stopChild);
app.on("window-all-closed", () => {
  stopChild();
  app.quit();
});
