// @ts-nocheck
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../ui/dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

const serve = (res, pathname) => {
  const index = path.join(DIST, "index.html");
  if (!isFile(index)) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("GUI not built. Run: npm run build\n");
    return;
  }
  const target = path.normalize(path.join(DIST, pathname === "/" ? "/index.html" : pathname));
  if (!target.startsWith(DIST)) { res.writeHead(400); res.end(); return; }
  if (isFile(target)) {
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(fs.readFileSync(target));
    return;
  }
  // SPA fallback
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(index));
};

export { serve };
