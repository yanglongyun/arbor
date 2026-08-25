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

### Electron 壳

`npm run app`:esbuild 把 server 打成 `dist/server.mjs`(node-pty 外置),
壳挑空闲端口用**系统 node** 拉起(避开 node-pty 对 Electron ABI 的重编译),
健康检查通过后窗口指向 `127.0.0.1:<port>`,外部链接走系统浏览器,退出杀子进程。
`ARBOR_HOME` 环境变量锚定仓库根(打包产物的 `__dirname` 不再是 server/)。

## 验证(2026-08-25,真实模型端到端)

- 建智能体 → 写文件任务:工具直播 → 轮收纳「已工作 8 秒」→ hello.txt 实时长进左侧树 → 分组展开子条目;
- 多智能体:create_agent 派活 → 子 agent 回信卡片 → caller 自动唤醒接力转告;
- 打包版 server 独立跑通(health / runs / 静态 UI);Electron 壳自选端口拉起 sidecar 并开窗;
- `npm run typecheck` 全绿。

## 已知限制 / 下一步

- 正式打包(electron-builder + 随包 node 或 electron-rebuild node-pty)未做,壳当前面向开发机;
- 运行中的智能体收到新邮箱消息(用户或别的 agent 发来)不会中途插入本轮,跑完后下一次运行才带上(与旧版一致);
- 压缩只在两次运行之间发生,超长单轮可能顶到上下文墙(maxRounds=64 兜底);
- /api/messages 全量返回,未分页。
