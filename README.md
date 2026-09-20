# SupportDesk AI

面向小型软件团队的内部客服与工单工作台：查阅知识 → 获取带来源的建议 → 人工确认工单 → 分配、处理和关闭。

**默认完全使用本地固定模板，没有任何 API Key，没有绑定任何 AI 账号，也不会调用模型服务。** 原始需求保留在根目录的《AI客服与工单工作台-开发计划.md》。

## 快速启动

已验证环境：Node.js 22.22.0、pnpm 10.30.1。无需 Docker、数据库服务或 AI 账号。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

打开 http://127.0.0.1:5173 。API 在 3001 端口。首次启动自动创建数据库、双工作区、演示账号和 12 份虚构产品资料。文档会在后台逐个建立索引，约十几秒完成。

默认数据库使用 PostgreSQL 的嵌入式实现 PGlite，数据持久化在 `.data/supportdesk`，不是浏览器 localStorage 假数据。关闭并重新启动不会丢失工单、会话或资料。不要同时启动两个进程打开同一个 PGlite 目录。

|角色|邮箱|默认密码|
|---|---|---|
|管理员|admin@demo.com|Demo123456!|
|客服|agent@demo.com|Demo123456!|
|访客，只读|viewer@demo.com|Demo123456!|

管理员可以切换 FlowSpace 和 Northstar 两个隔离工作区。账号密码仅用于虚构演示，不是 AI 凭据。

## 已实现

- 邮箱密码登录、bcrypt 哈希、HttpOnly Cookie、CSRF 与 Origin 校验、登录限速、退出登录。
- 工单筛选、标题搜索、服务端分页、URL 状态同步、创建/编辑/分配、乐观锁、状态机、追加备注和事务审计。
- 私人会话、POST SSE 流式答复、UTF-8 跨块解析、停止、重新生成、刷新恢复已保存内容、引用抽屉。
- Markdown/TXT 上传、1 MB 限制、异步任务、租约与重试、分块和向量检索、版本切换、删除失效。
- 固定模板草稿、人工编辑、确认建单、幂等与并发保护、24 小时草稿有效期。
- 普通、慢速、失败、空输出、超时、长回复和异常格式等模拟场景。
- 桌面与窄屏布局；模拟模式和只读权限有明确标记。

## API Key 的配置边界

`.env.example` 只保留空白输入位置。项目不带任何 Key、不读取个人 AI 账号、不自动关联 Codex/ChatGPT 账号，也不提供把 Key 存在浏览器里的机制。

默认不需要创建 `.env`。如以后自行接入兼容 chat/completions 与 embeddings 协议的服务，应在**服务端运行环境**注入以下配置；不要提交到仓库：

```dotenv
AI_MODE=mock
REAL_AI_ENABLED=false
MODEL_BASE_URL=
MODEL_API_KEY=
CHAT_MODEL=
EMBEDDING_MODEL=
EMBEDDING_DIMENSION=1536
```

只有将 `AI_MODE` 改为 `real`、`REAL_AI_ENABLED` 改为 `true`，且地址、Key、对话模型、向量模型均填写完整，才启用真实请求。缺少任一必需项，仍使用本地模板。已加入无 Key 时 `fetch` 不被调用的回归测试。

真实模式未运行验证，也未产生真实模型评测或费用。切换 embedding 模型后需要为知识文档提交新版本重新建立向量；不同模型的向量不会混用。模板输出是资料摘录与固定句式，不代表真实语义推理能力。

## 常用命令

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start          # API；构建后同时提供 dist/web 页面，访问 localhost:3001
pnpm eval           # 25 条开发集
pnpm eval --holdout # 15 条保留集，勿用于反复调参
pnpm perf           # 10012 条工单的数据库查询基准
pnpm db:seed        # 幂等种子脚本，先停掉占用相同本地数据库的服务
```

`pnpm start` 使用 3001 同源页面时，不要把 `APP_ORIGIN` 固定成 5173；没有 `.env` 时两个本机端口均允许。若从 `.env.example` 复制了配置，请把 `APP_ORIGIN` 改成实际页面来源，`localhost` 和 `127.0.0.1` 也须一致。

浏览器自动化脚本已提供：

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

## PostgreSQL + Docker

见 [部署文档](docs/deployment.md)。配置 `DATABASE_URL` 后使用 PostgreSQL + pgvector。Prisma 负责连接和事务，登录查找用户使用 Prisma Client；复杂联表、队列及向量检索使用绑定参数 SQL。SQL migration 是数据库约束的最终定义，不要用 `prisma db push` 覆盖它。

本机没有 Docker / PostgreSQL 服务，所以本次已运行的是 **PGlite 数据库集成测试**；独立 PostgreSQL、Docker Compose 和 GitHub Actions 已提供配置，但未冒充执行通过。

## 验证与交付范围

实际验证记录、评测、已知限制见 [验证报告](docs/verification.md)。任务完成情况和未交付项见 [交付状态](docs/delivery-status.md)。数据流与权限边界见 [架构说明](docs/architecture.md)。

- 本地完整源码、页面与服务可运行；PGlite 集成测试覆盖工作区隔离、事务、并发和流异常。
- 固定评测集共 40 条：12 直接、8 组合、8 无答案、6 版本、6 注入；分层划分为 25 开发 / 15 保留。
- 保留集模板检索覆盖 10/12，未达到 ≥85% 初始目标；不掩盖失败项，不用保留集继续调参。
- 尚无公网部署、真实模型验证或 3 人试用反馈。界面截图和演示录屏按当前约定暂不加入；操作步骤见 [演示脚本](docs/demo-script.md)，未把脚本当成已完成的视频。

## 文档

| 文档 | 内容 |
|---|---|
| [验证报告](docs/verification.md) | 已跑过的测试、评测分子/分母、性能范围、未执行项 |
| [交付状态](docs/delivery-status.md) | 对照开发计划的完成定义、P01–P22 和作品集材料 |
| [架构说明](docs/architecture.md) | 运行结构、权限、工单事务、流式运行、知识库边界 |
| [部署](docs/deployment.md) | PostgreSQL、Compose、备份步骤与 CI 配置边界 |
| [决策](docs/decisions/001-stream-and-idempotency.md) | POST 流、精确检索、人工确认与幂等 |
| [试用记录](docs/user-feedback.md) | 三人试用表，目前均为待招募 |
| [演示脚本](docs/demo-script.md) | 2–3 分钟口播提纲，尚未录制 |
| [依赖说明](docs/third-party.md) | 第三方许可证与素材来源 |

真实修复记录在 `docs/troubleshooting/`。原始规格是根目录《AI客服与工单工作台-开发计划.md》。

## 目录

```text
apps/web/          Vue 页面、组件、composable、路由与 Pinia
apps/api/          NestJS 进程启动；HTTP API、鉴权与流式响应在 Express 路由
apps/worker/       持久队列、文档向量化、超时回收
packages/contracts/  Zod DTO、状态约束、SSE 解析器
prisma/            schema 与 pgvector SQL migration
tests/             单元、组件、数据库集成与 Playwright 用例
evals/             固定数据集、评测脚本、真实运行记录
infra/             Docker Compose、镜像与 Nginx
docs/              架构、决策、复盘、部署、验证报告和交付状态
```

许可证：MIT。界面使用 CSS 与 Lucide 图标；无外部图片素材。第三方依赖保留各自许可证，见 [依赖说明](docs/third-party.md)。
