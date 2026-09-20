# SupportDesk AI

面向小型软件团队的内部客服工作台：查知识 → 带来源的建议 → 人工确认后建单 → 分配和处理。

默认使用本地固定模板，不需要 API Key，也不会调用模型服务。

## 启动

需要 Node.js 22+、pnpm 10。不必安装 Docker、PostgreSQL 或任何 AI 账号。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

打开 http://127.0.0.1:5173 。第一次启动会写入本地数据库、两个工作区和演示账号，知识文档在后台索引，大约十几秒完成。

| 角色 | 邮箱 | 密码 |
|---|---|---|
| 管理员 | admin@demo.com | Demo123456! |
| 客服 | agent@demo.com | Demo123456! |
| 访客，只读 | viewer@demo.com | Demo123456! |

管理员可在 FlowSpace 和 Northstar 两个隔离工作区之间切换。这些是虚构演示账号，不是模型凭据。

数据保存在 `.data/supportdesk`，关掉再开不会丢。不要同时开两个进程占用同一目录。停止开发服务：在运行 `pnpm dev` 的终端里按 `Ctrl+C`。

## 能做什么

- **工单**：筛选、搜索、创建、分配、状态流转、备注
- **助手**：流式答复、查看来源、停止/重试、人工确认后建单
- **知识库**：上传 Markdown/TXT、版本切换、检索与失效

## 技术栈

Vue 3、Vite、Pinia、NestJS / Express、Prisma、PGlite（默认）或 PostgreSQL + pgvector。

## 限制

- 没有在线演示，也没有真实模型评测。模板输出是资料摘录，不代表语义推理能力。
- 若要接入兼容 chat/completions 与 embeddings 的服务，在服务端按 `.env.example` 配齐后再打开真实模式；缺任何一项仍走本地模板。不要把 Key 提交进仓库。
- 更完整的命令、Docker 部署、测试与评测记录见下面的文档。

## 文档

| 文档 | 内容 |
|---|---|
| [架构说明](docs/architecture.md) | 运行结构、权限、工单与流式边界 |
| [部署](docs/deployment.md) | PostgreSQL、Compose、备份 |
| [验证报告](docs/verification.md) | 已跑过的测试和评测 |
| [交付状态](docs/delivery-status.md) | 对照开发计划的完成情况 |

原始需求在《AI客服与工单工作台-开发计划.md》。许可证：MIT。
