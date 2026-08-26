// @ts-nocheck
// agent 工具集。每个都带 reason 字段当摘要,UI 默认折叠只显示 reason,点开看完整参数+结果。

const tools = [
  {
    type: "function",
    function: {
      name: "shell",
      description:
        "在你的工作目录(你所在的空间目录)里执行会结束的 shell 命令并返回输出。" +
        "git/build/ls/grep/安装依赖等用它;长驻进程/dev server 请用 run_process,不要用 shell。" +
        "读写单个文件优先用 read_file/edit_file/write_file(更省 token)。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason:  { type: "string", description: "为什么执行(一句话摘要,UI 会显示)" },
          command: { type: "string", description: "要执行的命令" },
        },
        required: ["reason", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_process",
      description:
        "启动一个后台进程,用于 dev server、静态文件服务、watcher 等长驻命令。它会立即返回进程 id、日志片段和可能的 preview URL;不会阻塞智能体。" +
        "例如 npm run dev、python -m http.server、vite、next dev 都用它。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason:  { type: "string", description: "为什么启动这个进程(一句话摘要,UI 会显示)" },
          command: { type: "string", description: "要启动的命令" },
        },
        required: ["reason", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_processes",
      description: "列出当前 Arbor 后台进程,包括状态、命令、日志片段和 preview URL。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "为什么查看进程(一句话摘要)" },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_process_output",
      description: "读取某个后台进程的最新日志输出。用于检查 dev server 是否启动成功、端口是多少、有没有报错。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason:     { type: "string", description: "为什么读取日志(一句话摘要)" },
          process_id: { type: "string", description: "run_process 返回的进程 id" },
          tail:       { type: "number", description: "可选:最多返回多少字符(默认 8000,上限 40000)" },
        },
        required: ["reason", "process_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stop_process",
      description: "停止一个后台进程。用于关闭 dev server、watcher 等。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason:     { type: "string", description: "为什么停止(一句话摘要)" },
          process_id: { type: "string", description: "要停止的进程 id" },
        },
        required: ["reason", "process_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "读取一个文本文件,返回带行号的内容(便于随后用 edit_file 精确定位)。大文件用 offset/limit 分页。" +
        "相对路径相对你的工作目录。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "为什么读(一句话摘要)" },
          path:   { type: "string", description: "文件路径(相对你的目录或绝对路径)" },
          offset: { type: "number", description: "可选:从第几行开始读(1 起)" },
          limit:  { type: "number", description: "可选:读多少行(默认 2000,上限 2000)" },
        },
        required: ["reason", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "精确替换文件里的一段文本:把 old 替换成 new。old 必须在文件里唯一匹配(否则报错,请带更长上下文)。" +
        "改文件首选——比 shell sed / 重写整文件可靠且省 token。需替换多处可设 replace_all。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason:      { type: "string", description: "为什么改(一句话摘要)" },
          path:        { type: "string", description: "文件路径" },
          old:         { type: "string", description: "要被替换的原文(需在文件中唯一)" },
          new:         { type: "string", description: "替换成的新文本" },
          replace_all: { type: "boolean", description: "可选:替换所有匹配(默认只替换唯一一处)" },
        },
        required: ["reason", "path", "old", "new"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "把 content 写入文件(不存在则创建,父目录自动创建;存在则覆盖)。新建文件或整体重写时用它。" +
        "只改局部请用 edit_file。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason:  { type: "string", description: "为什么写(一句话摘要)" },
          path:    { type: "string", description: "文件路径" },
          content: { type: "string", description: "文件内容" },
        },
        required: ["reason", "path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "抓取一个网页 URL,去掉标签返回可读正文(已截断)。用来读一个已知链接的正文。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "为什么抓(一句话摘要)" },
          url:    { type: "string", description: "要抓取的 http(s) 链接" },
        },
        required: ["reason", "url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_agent",
      description:
        "在你所在的空间下创建一个新智能体(agent)。如果提供 message,会同时往它派发该初始消息(异步,不阻塞)。" +
        "对方跑完后,它的最终回复会自动作为新消息投进你的邮箱。reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason:  { type: "string", description: "为什么要创建这个智能体(一句话摘要)" },
          title:   { type: "string", description: "智能体名字" },
          message: { type: "string", description: "可选:初始消息" },
          system:  { type: "string", description: "可选:智能体的 system prompt" },
        },
        required: ["reason", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "call_agent",
      description:
        "给已存在的智能体发一条消息,异步。立即返回。对方跑完后,它的最终回复会自动作为新消息投进你的邮箱(meta.source='call_result')。" +
        "reason 是一句话摘要。",
      parameters: {
        type: "object",
        properties: {
          reason:   { type: "string", description: "为什么要调它(一句话摘要)" },
          agent_id: { type: "string", description: "目标智能体(agent)的 id" },
          message:  { type: "string", description: "要发送的消息" },
        },
        required: ["reason", "agent_id", "message"],
      },
    },
  },
];

export { tools };
