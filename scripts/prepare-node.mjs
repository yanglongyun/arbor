// 把系统 node 复制进 build/node-runtime,随包分发。
// 打包的 app 用它跑 server sidecar:node-pty 的 N-API prebuild 对上官方 node,零 ABI 纠纷。
import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "build/node-runtime");

const nodeBin = execSync("command -v node", { encoding: "utf8", shell: "/bin/zsh" }).trim();
if (!nodeBin) throw new Error("找不到 node,可执行文件必须在 PATH 里");

mkdirSync(OUT, { recursive: true });
copyFileSync(nodeBin, join(OUT, "node"));
chmodSync(join(OUT, "node"), 0o755);
console.log(`node runtime: ${nodeBin} → build/node-runtime/node(${process.version})`);
