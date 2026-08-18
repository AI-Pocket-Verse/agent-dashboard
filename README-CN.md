# Agent Dashboard

[English](README.md) | 中文

把多个 Claude Code agent 编排成 DAG 工作流的 Web 看板。在画布上摆放 agent、连线成流水线，每个节点真实拉起 `claude` CLI 进程执行，日志实时流式展示。

![工作流画布](docs/images/canvas.png)

![创建任务](docs/images/dashboard.png)

## 功能

- **DAG 工作流画布** —— 将自定义 agent 与 OMC agent 组合成串行/并行流水线（基于 @xyflow）；节点输出通过 `{{nodes.<id>.output}}` 插值传入下游提示词。
- **真实进程执行** —— 每个节点在隔离的 run 工作区内运行 `claude` CLI，WebSocket 实时推送日志。
- **AI 智能选型** —— 描述任务，由 Anthropic API 自动挑选并连接合适的 agent。
- **自动修复循环** —— `code-reviewer` 节点发现阻塞性问题时，自动提供最多 3 轮修复，并路由给合适的 agent。
- **运行历史与工作区浏览** —— 查看每次运行的产物文件、预览生成的 HTML 原型、分页加载日志。
- **可选密码鉴权** —— `DASHBOARD_SECRET` 留空即本机免密模式（不弹登录页、零记忆负担）；设置后一个密码同时保护 HTTP API（Bearer，时间安全比对）与 WebSocket 通道，Web UI 通过登录门输入一次。凡他人可访问的部署必须设置。

## 环境要求

- Node.js 22+、pnpm
- 已安装并登录的 [Claude Code](https://claude.com/claude-code) CLI（`claude` 在 PATH 中）
- `ANTHROPIC_API_KEY`（仅 AI 选型功能需要）

## 本机运行

```bash
git clone <repo-url> && cd agent-dashboard
./start.sh
```

就这一条命令，默认无密码。`start.sh` 首次运行会：

1. 生成 `.env`（`DASHBOARD_SECRET` 留空＝免密模式，`PROJECT_ROOT` 默认为上级目录）。
2. 按需安装依赖（`pnpm install`）。
3. 启动 server（3001，WebSocket 3002）和 client（5173）。
4. 自动打开浏览器访问 `http://localhost:5173` 。

`Ctrl+C` 停止；`./restart.sh` 清理端口后重新启动。想手动控制：

```bash
pnpm install
pnpm dev          # 等价于同时启动 server（tsx watch）与 client（vite）
```

如需本机也开启密码（比如局域网内他人可访问你的电脑），在 `.env` 里设置后重启：

```bash
DASHBOARD_SECRET=$(openssl rand -hex 16)
```

## Docker 部署

部署到服务器时 `DASHBOARD_SECRET` **必须设置**——留空等于向所有能访问主机的人敞开。

```bash
DASHBOARD_SECRET=$(openssl rand -hex 16) \
PROJECT_ROOT=/path/to/your/projects \
ANTHROPIC_API_KEY=sk-ant-... \
docker compose up -d --build
```

打开 `http://<host>/` ，在登录门输入 `DASHBOARD_SECRET`。架构说明：

- 只有 nginx（80 端口，client 容器）对外：托管 Web UI，并把 `/api` 代理到内部 server:3001、`/ws` 代理到 server:3002。
- server 容器内置 `claude` CLI，通过 `ANTHROPIC_API_KEY` 认证。
- 运行历史持久化在宿主机 `./server/data`；agent 工作区在 `PROJECT_ROOT/workspace` 下。
- 凡可从公网访问的部署，请在前面加 TLS（token 经请求头和 WS 查询串传输）。

**生产构建严禁设置 `VITE_DASHBOARD_SECRET`** —— 那会把密钥编译进 JS bundle，它只是本机开发的免登录便利项。

## 配置

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `DASHBOARD_SECRET` | （空） | API 与 WebSocket 的共享密码；留空即免密（本机模式），部署必须设置 |
| `PROJECT_ROOT` | 无（必填） | 文件选择器可浏览的根目录 |
| `WORKSPACE_ROOT` | `$PROJECT_ROOT/workspace` | 每次运行的 agent 工作区位置 |
| `CLAUDE_BIN` | `claude` | Claude CLI 可执行文件 |
| `PORT` | `3001` | HTTP 端口（WebSocket 用 `PORT+1`） |
| `DATA_DIR` | `server/data` | SQLite 与运行历史存储 |

## 从源码构建

```bash
pnpm install
pnpm --filter server test && pnpm --filter client test
pnpm dev   # server + client 热更新
```

## License

[Apache-2.0](LICENSE)
