# Arbor 🌳

> 对话 = 一个 agent = 树上的一个节点。

![Arbor — 左侧工作树 · 中间落地页预览 · 右侧多智能体协作](docs/screenshot.png)

我认为这个项目主要有这几个亮点:

## 一、对话即 agent,彼此通讯

目前,我们在 ChatGPT、Claude 上的历史对话大多都是沉寂的,但其实每个对话历史就是一个已经有上下文的 AI 智能体,本项目让它们之间彼此感知,相互通讯。

## 二、异步调用

实现也很简单:`call` 工具往另一个 agent 的消息记录里 push 一条消息,然后立即返回——不等它跑完,所以不会阻塞你自己这边的对话。对方在后台执行,跑完后,系统把它的结果作为一条新消息投回调用方的消息里,并自动唤醒调用方接着处理。所以整个调用是异步的。

## 三、树形组织

再然后,我们用树形结构把这些智能体组织起来,这样你可以有组织地、有层级地放置这些智能体,每个智能体都可以感受到自己的环境信息、指导文件、技能。

---

下面再多说一点。

## 每个 agent,有一块真实的工作目录

agent 所在的文件夹,就是它的工作目录,它的 `shell`、读写文件都在这里执行。你让它「做个网页放这」,它会真的 `write_file`、跑命令,在目录里长出 `index.html`——这个文件随即出现在左侧的树里,可点开、可编辑、可预览。AI 产出的是真实文件,而不是对话框里的一段代码。

## 它如何存储:文件系统即真相

结构不在数据库里,而在文件系统里(`workspaces/` 这个由 app 自管的根目录,它自行生长,你不导入既有目录):

```
workspaces/
  研究/                       ← 文件夹 = 真实目录
    a1b2….agent.json          ← 智能体 = 一份元数据(人格 / 已读位置 / 创建时间)
    notes.md                  ← 文件 = 真实文件
    src/  app.js              ← AI 用 shell 建的嵌套结构,本就是树的一部分
    子文件夹/                 ← 嵌套 = 子目录,可无限深
```

一句 `ls` 就能看清整棵树。SQLite 只承载运行时状态,不存结构:

| 表 | 内容 |
|---|---|
| `messages` | 每个智能体的消息流(`agent_id` = 智能体的 uuid) |
| `calls` | 智能体之间的调用关系 + 状态机(`pending / running / done / error / cancelled`) |
| `settings` | 模型 / key / 默认 system prompt |

**id 规则**:文件夹与文件用路径(改名、移动即变,前端重新拉取,无需 fs↔DB 同步);智能体用 uuid(稳定,`call_agent` 凭它寻址)。

## agent 手里的工具(11 个)

| 工具 | 用途 |
|---|---|
| `shell` | 在工作目录里执行**任意**命令——全功能,建目录、跑构建都在此 |
| `run_process` | 启动后台进程 / dev server / watch,不阻塞;日志与预览 URL 进入进程面板 |
| `list_processes` · `read_process_output` · `stop_process` | 查看 / 读取 / 停止后台进程 |
| `read_file` · `edit_file` · `write_file` | 带行号读 / 精确替换 / 整体重写(改文件首选这三个,比 shell sed 稳且省 token) |
| `web_fetch` | 抓取一个网页链接的正文,返回可读文本 |
| `create_agent` | 在当前文件夹下派生一个兄弟智能体,可附初始消息(异步) |
| `call_agent` | 向已存在的智能体发消息(异步,结果回到自己的消息流) |

> ⚠️ `shell` 在**你本机**执行任意命令、**无沙箱**——这是本地 agent 工具的常态。只在你信任的机器、对你信任的模型使用。

## 用起来什么感觉

前端是一套 VSCode 式的本地 GUI,常用的都顺手:

- **流式输出**,思考与正文逐字实时呈现;完成的一轮自动收纳成「已工作 X 秒」折叠条,最终回复站在外面,过程(思考 / 工具 / 中间文本)点开细看
- 模型协议是 **Responses**,不随供应商变 —— 接任何 Responses 兼容接口 / 网关,换供应商只换 URL
- **多标签 + 左右分屏**;代码按扩展名高亮(CodeMirror);Markdown / HTML / 图片 / PDF 直接在标签内预览
- **⌘P 快速打开 · ⌘⇧F 全局搜索 · ⌘⇧P 命令面板**
- agent 运行时亮起**蓝点**、有未读则亮**绿点**,一眼看出谁在忙
- 让某个 agent 起 dev server,`run_process` 会自动识别**预览 URL**,旁边开个面板即可看效果
- 内置**终端**(可在某个 agent 的目录里直接拉起 codex / claude code)与一个 **Git 面板**
- 拖拽基于 dnd-kit 三 sensor(鼠标 / 触摸 / 键盘),**桌面与手机共用一套代码**

## 跑起来

```bash
git clone https://github.com/realuckyang/Arbor
cd Arbor
npm install

# 开发(两个进程)
npm run dev          # 后端,tsx watch,端口 9506
npm run ui          # 前端,vite dev,端口 5174(代理到 9506)

# 生产(构建 GUI,单端口运行)
npm run build        # vite build → ui/dist
npm start            # 后端 + GUI 同端口 http://localhost:9506

# 桌面客户端(Electron 壳,自动挑端口拉起本地服务)
npm run app

# 打成 macOS 应用(release/mac-arm64/Arbor.app,含图标与随包 node)
npm run dist:mac
```

开发模式打开 **http://localhost:5174/**:

1. 左下角 ⚙ Settings → 填 API URL / API Key / Model(任何 OpenAI 兼容接口)
2. 左侧 `＋` → 新建一个智能体
3. 发条消息试试——让它「做个网页放这」,看它在自己的工作目录里长出文件,直接出现在树里

## 技术栈

Node 22+ · TypeScript · `node:sqlite`(内置,零外部数据库依赖)· React 19 · Tailwind 4 · Vite · CodeMirror 6 · @dnd-kit · ws · Electron(桌面壳)

## 想读代码——架构

分层清晰:**ai(内核)→ tools / runs(编排)→ repo(数据)→ api / realtime(通道)**。

```
ai/               🧠 无状态 AI 内核(Responses 协议,纯 JS 零依赖):模型 → 工具 → 模型的循环 / SSE 解析 / 一次性补全
server/
├── shared/       📜 事件名契约(conversation.*),服务端与界面共用一份,不写裸字符串
├── tools/        🔧 11 个工具的定义与实现(全部必填 summary,一句话摘要给界面);外部能力经 ctx 注入
├── runs/         🎬 运行编排——逐条落库 / 事件广播 / 压缩水位 / 停止收尾(悬空调用补输出 + [stopped] 留痕)/ 回信并唤醒调用方
├── service/      🌳 tree.ts(树操作 + 事件)
├── repo/         💾 纯数据访问——tree.ts(文件系统即树)/ messages(一行一个 Responses item)/ calls / settings / search
├── api/          🌐 HTTP(很薄,只解析请求、拼响应)
└── realtime.ts   📡 WebSocket(send 立即返回,事件按 agentId 认领;终端多路复用)
desktop/          🖥 Electron 壳:esbuild 单文件 server 由壳拉起,窗口指向 127.0.0.1
ui/src/components/   React 前端,按 UI 区域分模块:explorer(树)/ workspace(编辑器外壳 + panels)/ command / chat(按轮收纳的消息流)/ files / settings / ui
```

`ai/` 不知道树是什么,只接收组装好的 items、工具表和执行映射跑循环;运行编排与状态全在 `server/`。消息**逐条落库**:每个 item(思考 / 正文 / 工具调用 / 结果)完成即入库,中途停止只丢正在流式的半句,切标签、刷新、开多窗口都不丢流。

## 几句实话

- `shell` 全功能、**无沙箱**,只在你信任的机器、对你信任的模型使用。
- 提示词与注释**均为中文**,不习惯的话需要适应。
- 它是实验性的,不面向生产。

## License

MIT
