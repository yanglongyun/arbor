# Arbor 0.2.0 — 换心脏:AI 内核、消息格式与对话栈整体重造

## 版本目标

把 0.1.x 的 agent 核心与对话栈,换到 AGENT 项目(0.0.3)验证过的成果上:
Responses 协议的无状态内核、一行一个 item 的消息格式、事件契约广播、逐条落库与停止收尾、
按轮收纳的对话体验。不打补丁 —— `server/agent/`(chat 循环、四个 provider 流解析器、旧 runner)
整个删除,由新分层替代。workspace 外壳(树 / 标签 / 终端 / Git / 命令面板 / 进程面板)原样保留。
另新增 Electron 桌面壳。

## 结构变化

```text
删除  server/agent/            (chat loop / lm 多 provider 解析 / 旧 tools+runner)
删除  server/service/agent.ts  (旧编排:整轮结束才落库)
新增  ai/                      无状态内核,与 AGENT 同源(Responses / SSE / 工具循环 / complete)
新增  server/shared/events.ts  conversation.* 事件契约,服务端与 UI 共用一份
新增  server/tools/            11 个工具:定义(扁平 Responses 格式,必填 summary)+ 实现 + 装配
新增  server/runs/             运行编排 / item 版压缩 / system prompt 拼装
新增  desktop/                 Electron 壳(esbuild 单文件 server 由壳拉起)
重写  server/repo/messages.ts  一行一个 Responses item(body=item, meta=邮箱语义, usage=轮用量)
重写  server/realtime.ts       send 立即返回,运行后台转;事件广播按 agentId 认领
重写  ui/components/chat/      thread/stream/Process/MessageStream/ChatPanel(按轮收纳)
```

## 核心变化

### 协议:只走 Responses(本版实质取舍)

内核只说 Responses,reasoning 是一等公民,四个 provider 解析器删除。
设置里的 API URL 语义改为 **Responses 端点**(如 `…/v1/responses`);
Kimi / Gemini 官方 chat-completions 端点不再直连,需经 Responses 兼容网关。

### 消息:一行一个 item,逐条落库

`messages.body` 从 chat-completions message(assistant 内嵌 tool_calls 数组)
换成 Responses item(reasoning / message / function_call / function_call_output 各自一行)。
每个 item 完成即落库 —— 中途停止或崩溃只丢正在流式的半句,已完成的轮次全保留。
**旧库不迁移**(未上线),原库备份在 `database/arbor.db.bak-0.1.0`。

### 停止 / 出错收尾

- 悬空的 function_call 补一条错误输出(Responses 要求调用与输出成对,缺了下一轮请求被拒);
- 落 `[stopped]` / `[error]` 系统留痕:界面渲染成药丸,也进上下文给模型看;
- **失败也回信给 caller**(旧版只在成功时回信,失败时调用链会永远空等)。

### 运行模型

`send` 落库用户消息后立即返回;轮子在 `runs/` 后台转,事件从 ws 广播、按 agentId 认领。
切标签、刷新、多窗口不丢流;`GET /api/runs` 供界面初始化对账。
压缩改为**两次运行之间**按用量水位触发(阈值沿用 settings.compressThreshold),
模型摘要失败落机械索引兜底,摘要作为 `meta.kind='compaction'` 的邮箱消息 + compactions 锚点,
此后历史从锚点之后取。

### 对话体验(与 AGENT 0.0.3 同构,Notion 风格蒙皮)

完成的轮收进「已工作 X 秒」折叠条,最终文本全宽站外;进行中的轮平铺直播。
思考 / 工具过程行(图标⇄chevron,展开参数/输出双块,summary 从参数中剥掉);
相邻已完成常规工具收成「写入了 N 个文件,读取了 N 个文件」;
create_agent / call_agent 永不进分组 —— 多智能体动作是 Arbor 的招牌,永远单独可见;
agent 来信 / 子 agent 回信保留居中卡片;运行中扫光、粘底滚动、日期条、
草稿按智能体持久化、markdown 净化升级到渲染器层(丢原始 HTML、中和危险协议)。

### Electron 壳与正式打包

`npm run app`(开发):esbuild 把 server 打成 `dist/server.mjs`(node-pty 外置),
壳挑空闲端口用**系统 node** 拉起(node-pty 1.x 自带 N-API prebuilds,无 ABI 纠纷),
健康检查通过后窗口指向 `127.0.0.1:<port>`,外部链接走系统浏览器,退出杀子进程。

`npm run dist:mac`(打包):electron-builder 出 `release/mac-arm64/Arbor.app`(~414MB)。
- 图标:`desktop/icon.svg`(源)→ `scripts/make-icon.mjs`(sharp 栅格化 + iconutil)→ `icon.icns`;
  同一 SVG 兼作前端 favicon(`ui/public/icon.svg`)。
- 随包 node:`scripts/prepare-node.mjs` 复制系统 node 进 `build/node-runtime`,
  打进 `Resources/core/bin/node`;server 单文件与 `ui/dist`、node-pty 一起进 `Resources/core/`。
- 路径分离:打包态 `ARBOR_HOME` = `~/Library/Application Support/Arbor`(database + workspaces),
  `ARBOR_UI_DIST` 指向只读资源区的前端;开发态两者同在仓库根,行为不变。
- 签名:electron-builder 自动取钥匙串里的 Developer ID;未做公证(本机分发用不上)。

已实测:打包版独立拉起 sidecar、health 通过、种子数据(settings / workspaces 树)完整可用。
注意:workspaces 表存的是绝对路径,桌面 app 与 dev 指向同一片工作树(文件系统即真相);
消息库(SQLite)则各自一份,两边的对话历史会分叉 —— 开发期可接受。

## 验证(2026-08-25,真实模型端到端)

- 建智能体 → 写文件任务:工具直播 → 轮收纳「已工作 8 秒」→ hello.txt 实时长进左侧树 → 分组展开子条目;
- 多智能体:create_agent 派活 → 子 agent 回信卡片 → caller 自动唤醒接力转告;
- 打包版 server 独立跑通(health / runs / 静态 UI);Electron 壳自选端口拉起 sidecar 并开窗;
- `npm run typecheck` 全绿。

## 补记(同版本内继续)

- **图标定稿为「双色」方案**:绿→蓝对角渐变(自然×智能)+ 白色有机树,从 7 个候选方向
  (暗夜信号 / 品牌蓝 / 字标 A / 生长 / 星丛 / 环冠 / 双色)中人工选定。
- **工作区文件监听**(server/watcher.ts):对每个工作区根挂 `fs.watch({recursive})`
  (libuv 在 macOS 走 FSEvents,与 VS Code 同一内核机制,零依赖),事件节流 400ms 后广播
  tree_changed —— Finder / 终端 / dev server / git 改磁盘,树自动刷新;IGNORE_DIRS 内的抖动不触发。
- **修复前端事件竞态**:useSocket 从前每次渲染返回新对象,依赖它的 effect 每渲染重跑,
  cleanup 把 300ms 节流中的定时器一并清掉 —— tree_changed 到了、handler 也注册着,刷新却被
  静默吞没。修法:useSocket 返回值 useMemo 恒定 + 节流定时器入 ref + 卸载后不再拉起僵尸重连。
  这也是「智能体改完文件树有时不动」的老病根,不只影响新监听器。

### 打包版数据落位(macOS 惯例)

程序、数据、文档三分离:`.app` 只读;**数据库**留 `~/Library/Application Support/arbor/`
(`ARBOR_HOME` = userData);**默认工作区**改到 `~/Documents/Arbor/`(`ARBOR_WORKSPACES`)——
工作区是用户要在 Finder 里摸的真实文件树,按「用户文档」惯例放 Documents,不埋 Library
(对照 Obsidian vault / Logseq graph)。开发态两者仍在仓库根,行为不变。
顺带清掉了种子期误留的 AppSupport 工作区副本(与仓库树同 UUID 的重复 agent),
仓库那棵树在桌面 App 里改名「arbor」,不再和默认根同名。

### 智能体退出文件树(结构性修正)

「对话 = 树上的一个节点」被证明是个错误:`<uuid>.agent.json` 落在用户目录里污染真实项目
(挂 Desktop 当工作区后尤其刺眼),文件树混进会呼吸的过程数据,类别混乱。修正:

- **智能体 = SQLite 一条记录 + 绑定的 workdir**(repo/agents.ts);磁盘上不再有 .agent.json,
  启动时一次性把历史文件迁入库并删除;
- **侧栏改 VS Code 式顶部 tab**:「会话」(置顶/最近、呼吸点、未读、悬停操作)|「文件」(纯文件树);
- 保留的可见性:文件夹行尾徽标(N 个智能体绑定此目录)、聊天顶部 workdir 芯片(点击去文件树定位)、
  文件夹右键「在此新建智能体」;
- 目录改名/移动 → 绑定 workdir 前缀跟随;目录删除 → 智能体不陪葬,workdir 塌缩到父目录;
- create_agent 派生的子智能体继承调用者的 workdir,「在你所在文件夹里派生」语义不变;
- messages/calls 本就按 uuid 寻址,历史对话零损耗。

### 命名交给系统(新建即开聊)

「新建智能体 + 先起名」改为「新建对话」零打扰:点 + 直接落一条「未命名对话」并打开;
首条消息跑完后 runs 层发起**独立的取名补全调用**(与对话运行完全分离,不挡终局),
失败退回机械截断(用户消息前 24 字),保证一定脱离「未命名对话」。
入口文案统一为「新建对话 / 在此新建对话」;自动取名与手动重命名经 agents_changed
同步到侧栏与标签页(标签存的是快照,挂载时也对齐一次)。

### 网页标签(Electron webview)

侧栏加第三个 tab「网站」;标签页能开真实网页 —— Electron 壳里是 `<webview>`(真会话、真登录态),
纯浏览器/dev 下退化成一块诚实的兜底(日常站点普遍禁 iframe,不硬塞)。要点:

- `desktop/main.js` 开 `webviewTag`,并给 webview 装 window.open 处理(留在原地导航,不弹窗);
- 网页标签在 WorkspaceGroup 里**常驻挂载、CSS 控显隐** —— `<webview>` 卸载 = 断网重载,登录态全丢;
- `sites` 表存收藏(service/sites.ts,url 归一化 + http(s) 校验);网站 rail 点击即开标签,
  顶部 + 与命令面板「打开网址…」也进同一入口;
- WebPanel 自带地址栏 / 后退前进 / 刷新 / 复制 / 系统浏览器,标题与地址跟着 webview 事件走。

## 已知限制 / 下一步

- 打包只出 mac-arm64 的 dir 目标(本机自用);dmg / 多平台 / 公证未做;
- 运行中的智能体收到新邮箱消息(用户或别的 agent 发来)不会中途插入本轮,跑完后下一次运行才带上(与旧版一致);
- 压缩只在两次运行之间发生,超长单轮可能顶到上下文墙(maxRounds=64 兜底);
- /api/messages 全量返回,未分页。
