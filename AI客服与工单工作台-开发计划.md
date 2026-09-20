# AI 客服与工单工作台：可执行开发计划

适用背景：Vue 为主、两年多前端经验、面向国内前端及偏前端全栈岗位。本文是开发规格和任务计划，尚未实现项目；性能数值与评测门槛均为目标，不是已取得的结果。

## 1. 项目目标与完成定义

项目暂名 SupportDesk AI。面向小型软件团队的内部客服人员，帮助他们查找产品资料、生成有依据的答复、把未解决的问题转为工单。

核心流程：客服输入客户问题 → 检索知识库 → 流式展示带引用的建议 → 查看来源 → 请求生成工单草稿 → 人工编辑并确认 → 创建工单 → 分配及处理 → 关闭。

该项目不是面向公众的无人值守客服，也不自动发送邮件、退款或修改客户账号。第一版的客户问题由客服粘贴输入，回复由客服复制使用。

最终完成需要满足：

- 有可访问的演示站、演示数据和清晰的模拟模式标记。
- 可以从零启动本地环境；不配置模型密钥也能运行模拟流程。
- 真实模型模式可以完成检索、回答、引用和工单草稿生成。
- 有两个工作区的数据隔离测试，不能依赖前端隐藏按钮保证权限。
- 取消、失败、刷新、重复提交等关键异常有明确行为与测试。
- 有固定评测集、实测报告、架构说明和至少两篇真实问题复盘。
- 找至少 3 名试用者完成指定任务，记录问题并完成一轮改进；没有招募到时如实记录，不编造反馈。

## 2. 版本范围

### v0.1：普通工单系统

账号登录、工作区权限、工单列表及详情、创建与分配、状态流转、操作历史、基础部署。先完成稳定业务闭环。

### v0.2：AI 会话

新建会话、流式回复、停止、失败处理、历史消息、刷新恢复已保存内容、模拟模型适配器。

### v0.3：知识库问答

Markdown/TXT 文档、异步处理、向量检索、引用定位、无依据答复、文档更新及失效处理。

### v1.0：完整求职作品

AI 工单草稿、人工确认、幂等创建、权限回归测试、固定评测、在线演示、README、演示视频和试用反馈。

### 第一版明确不做

- 微信/企微/邮件/电话接入、自动对客发送。
- OCR、复杂 PDF、网页爬取、图片理解。
- 多 Agent、自主执行任意工具、模型训练。
- 可配置工作流、计费订阅、组织邀请邮件。
- WebSocket 双向通信、微服务、Kubernetes。
- 全套通用组件库；完成主项目后再提炼。
- 流式事件的断线续传。断线后保存部分结果并显示“已中断”，重新生成是新的一次运行。

## 3. 用户、权限与业务规则

初期用种子脚本创建用户和两个工作区，不开放注册。登录使用邮箱和密码；密码使用成熟哈希库处理。账号可属于多个工作区，但 UI 首版可以只提供简单切换器。

| 行为 | 管理员 admin | 客服 agent | 访客 viewer |
|---|---|---|---|
| 查看本工作区工单、已就绪文档 | 可以 | 可以 | 可以 |
| 创建、编辑工单、添加备注 | 可以 | 可以 | 不可以 |
| 分配工单、改变状态 | 可以 | 可以 | 不可以 |
| 上传、更新、删除知识库文档 | 可以 | 不可以 | 不可以 |
| 发起 AI 请求、确认工单草稿 | 可以 | 可以 | 不可以 |
| 查看会话 | 仅自己的 | 仅自己的 | 不可以 |
| 查看跨工作区数据 | 不可以 | 不可以 | 不可以 |

第一版文档对工作区内成员统一可见，不实现逐文档 ACL。管理员也不能直接读取其他成员的私人会话。权限判断由服务端执行，当前用户 ID 从登录态获取。

工单字段：标题、描述、优先级 low/medium/high、状态、负责人、创建人、来源会话（可空）、创建及更新时间。

工单状态：open → in_progress → resolved → closed；resolved 可以返回 in_progress；closed 可以重新打开为 open。其他跳转返回业务错误。备注仅追加，第一版不编辑或删除历史备注。状态改变与操作历史写入同一数据库事务。

## 4. 页面与交互规格

| 路由 | 页面 | 必做内容 |
|---|---|---|
| /login | 登录 | 表单校验、错误提示、登录过期处理 |
| /tickets | 工单列表 | 状态/优先级/负责人筛选、标题搜索、分页、创建入口 |
| /tickets/:id | 工单详情 | 内容、分配、状态操作、备注、时间线 |
| /assistant | AI 工作台 | 会话列表、消息区、输入区、引用抽屉、工单草稿卡片 |
| /knowledge | 知识库 | 上传、处理状态、失败原因、重试、更新、删除 |
| /knowledge/:id | 文档详情 | 当前版本、正文、分块预览、处理信息 |

所有页面覆盖：加载中、空数据、无搜索结果、无权限、服务端错误、可重试错误。桌面 1440px 和笔记本 1280px 为主要布局目标，窄屏保留基本查看能力。

工单筛选同步 URL，刷新或复制链接后保持条件；输入搜索加防抖，过期请求不能覆盖新结果；分页由服务端执行。

AI 工作台规则：

- Enter 发送、Shift+Enter 换行；中文输入法合成期间 Enter 不触发发送。
- 同一会话最多一个活动运行，发送中显示停止按钮。
- 接近底部时自动跟随；用户上滑后暂停跟随，显示“回到最新”。
- 展示检索中、生成中、已完成、已取消、已中断、失败，不能一直转圈。
- 重新生成创建新运行，并标明与旧结果的关系，不覆盖原记录。
- 模型输出渲染禁用原始 HTML 或执行严格清洗；链接限制协议，代码块不可执行。
- 显示模型与模拟模式标记。复制内容时保留简短来源标记。

## 5. 技术方案与目录

采用 pnpm workspace 管理一个仓库，前后端使用 TypeScript。

| 层 | 选型 | 使用边界 |
|---|---|---|
| 前端 | Vue 3、Vite、Vue Router、Pinia、Element Plus | Pinia 管理登录/工作区等全局状态；会话和页面逻辑用 composable 分离 |
| 后端 | Node.js、NestJS | REST API、认证授权、流式转发、业务服务 |
| 数据库 | PostgreSQL + pgvector | 业务数据和向量放同一数据库 |
| 数据访问 | Prisma + 参数化 SQL | 常规 CRUD 用 Prisma；向量字段和检索按适配情况使用 SQL migration 与参数化查询 |
| 异步任务 | PostgreSQL 任务表 + 独立 worker 进程 | 第一版不引入 Redis；任务必须可恢复，不能只存在内存 |
| AI | 一个真实供应商适配器 + MockAdapter | 问答、embedding、结构化草稿由接口隔离；供应商可按实际可访问性选择 |
| 测试 | Vitest、Vue Test Utils、Playwright | 组件、业务、真实数据库集成、端到端 |
| 交付 | Docker Compose、GitHub Actions | 本地复现、CI、部署 |

开发开始时选择相互兼容的稳定版本，记录 Node 与 pnpm 版本并提交锁文件。不在计划中猜测最新版本。

```text
supportdesk-ai/
  apps/
    web/src/
      pages/ components/ composables/ services/ stores/ router/
    api/src/
      auth/ workspaces/ tickets/ conversations/ knowledge/
      ai/ jobs/ audit/ common/
    worker/src/
  packages/
    contracts/           # 请求响应及流事件契约，不直接暴露数据库模型
  prisma/
    schema.prisma migrations/ seed.ts
  evals/
    datasets/ scripts/ reports/
  tests/e2e/
  docs/
    architecture.md decisions/ troubleshooting/ demo-script.md
  infra/
    compose.yaml proxy/
  .github/workflows/
  .env.example
  README.md
```

架构流向：Vue → 同源反向代理 → NestJS → PostgreSQL；NestJS 调用模型服务。worker 从任务表获取文档处理任务，调用 embedding 服务，将结果写入数据库。所有模型密钥仅存在服务端环境变量。

文档首版限制为 UTF-8 Markdown/TXT、每份不超过 1 MB，正文直接存数据库，不额外建设对象存储。限制可配置，超限返回明确错误。

## 6. 数据模型

所有租户业务表均带 workspace_id。ID 可用 UUID；时间统一存 UTC，页面按本地时区显示。以下是必需字段，不是最终 SQL。

| 表 | 关键字段与约束 |
|---|---|
| users | id、email unique、password_hash、display_name |
| sessions | token_hash、user_id、expires_at；登出可失效 |
| workspaces | id、name |
| memberships | workspace_id、user_id、role；联合唯一 |
| tickets | id、workspace_id、title、description、priority、status、assignee_id、created_by、source_conversation_id、version、timestamps |
| ticket_comments | id、workspace_id、ticket_id、author_id、body、created_at |
| audit_logs | workspace_id、actor_id、entity_type、entity_id、action、before/after、request_id、created_at |
| conversations | id、workspace_id、owner_id、title、timestamps |
| messages | id、workspace_id、conversation_id、role、content、status、run_id、created_at |
| ai_runs | id、workspace_id、conversation_id、user_message_id、status、model、prompt_version、usage、latency、error_code、client_request_id、timestamps |
| documents | id、workspace_id、title、active_version_id、deleted_at、timestamps |
| document_versions | id、document_id、workspace_id、version_no、body、content_hash、status、error、embedding_model、embedding_dimension |
| document_chunks | id、workspace_id、version_id、chunk_index、heading、start_offset、end_offset、text、embedding |
| message_citations | message_id、workspace_id、chunk_id、version_id、label、quoted_text；保存引用快照 |
| jobs | id、workspace_id、type、payload、status、attempts、run_after、locked_until、locked_by、last_error |
| tool_drafts | id、workspace_id、conversation_id、run_id、created_by、payload、status、version、ticket_id、expires_at |
| idempotency_records | workspace_id、actor_id、operation、key、request_hash、response、created_at；作用域内 key 唯一 |

索引优先：tickets(workspace_id,status,updated_at)、messages(conversation_id,created_at)、document_chunks(workspace_id,version_id)、jobs(status,run_after)。工单搜索首版用标题包含匹配，在实测慢之前不增加复杂搜索系统。

应用查询必须显式带 workspace_id；跨表关联既验证 ID，也验证工作区一致。可用复合外键强化隔离。读取会话还需要 owner_id。数据库 RLS 留作后续加强，不把它和应用授权混为一谈。

工单更新携带 version，使用条件更新实现乐观锁；冲突返回 409，前端提示刷新，不静默覆盖别人的更改。

## 7. API 清单

普通 API 统一前缀 /api；错误返回 { code, message, requestId, details? }。列表返回 items 和分页信息。请求 DTO 服务端校验，不只依赖共享 TS 类型。

| 方法与路径 | 用途 |
|---|---|
| POST /auth/login；POST /auth/logout；GET /auth/me | 登录、登出、当前用户 |
| GET /workspaces；GET /workspaces/:wid/members | 工作区和可分配成员 |
| GET/POST /workspaces/:wid/tickets | 列表、创建；创建支持 Idempotency-Key |
| GET/PATCH /workspaces/:wid/tickets/:id | 详情、编辑；PATCH 携带 version |
| POST /workspaces/:wid/tickets/:id/transitions | 状态迁移，携带目标状态及 version |
| GET/POST /workspaces/:wid/tickets/:id/comments | 备注 |
| GET /workspaces/:wid/tickets/:id/activity | 操作历史 |
| GET/POST /workspaces/:wid/conversations | 会话列表、创建 |
| GET /workspaces/:wid/conversations/:id/messages | 历史消息 |
| POST /workspaces/:wid/conversations/:id/runs | 提交问题并返回流，携带 clientRequestId |
| GET /workspaces/:wid/runs/:id | 查询运行状态和已保存结果 |
| POST /workspaces/:wid/runs/:id/cancel | 取消本人运行 |
| GET/POST /workspaces/:wid/documents | 文档列表、上传，上传返回 202 和 jobId |
| GET/DELETE /workspaces/:wid/documents/:id | 查看、软删除 |
| POST /workspaces/:wid/documents/:id/versions | 上传替换版本 |
| POST /workspaces/:wid/documents/:id/retry | 重试失败处理任务 |
| GET /workspaces/:wid/jobs/:id | 处理状态；前端短轮询 |
| GET /workspaces/:wid/citations/:id | 引用正文与定位，重新鉴权 |
| POST /workspaces/:wid/conversations/:id/ticket-drafts | 生成结构化工单草稿 |
| PATCH /workspaces/:wid/ticket-drafts/:id | 编辑草稿，携带 version |
| POST /workspaces/:wid/ticket-drafts/:id/confirm | 幂等确认并创建工单，携带版本与 Idempotency-Key |
| POST /workspaces/:wid/ticket-drafts/:id/cancel | 取消未提交草稿 |

登录使用 HttpOnly 会话 Cookie；生产设置 Secure、SameSite。采用同源部署，对写请求校验 Origin 并实现 CSRF 防护。登录限速；错误不泄露密码或会话令牌。

## 8. AI 流式协议与状态

用 fetch 发起 POST 并读取响应流，响应类型为 text/event-stream。原生 EventSource 不作为此 POST 接口的客户端。解析器必须支持 UTF-8 跨块解码、事件跨块、一个网络块包含多个事件，不能把一个网络 chunk 当作一个完整消息。

应用事件约定：

```text
run.started       {runId, messageId, seq}
retrieval.started {runId, seq}
sources.ready     {runId, sources:[{citationId,label,title}], seq}
message.delta     {runId, text, seq}
run.completed     {runId, usage?, durationMs, seq}
run.cancelled     {runId, seq}
run.failed        {runId, code, message, seq}
```

事件 seq 只用于排序和排查，第一版不承诺按 seq 重放。应用终止事件只发一次。心跳使用 SSE 注释；代理关闭响应缓冲并设置合适超时。

ai_runs 状态：pending → retrieving → generating → completed；活动状态可进入 cancelled/failed/interrupted。模拟模式复用相同协议。

取消按钮先调用取消接口，再中止客户端读取；后端取消上游请求，保存部分内容。连接丢失也触发后端清理。异常退出后由超时回收逻辑将长期活动运行标记为 interrupted。完成和取消竞争时通过数据库条件更新确定唯一终态。

message.delta 在前端按帧或短时间窗口批量更新；服务端按时间/字符阈值保存快照，终态强制落库。快照间隔意味着崩溃时可能丢失最后少量未保存字符，需要在设计文档明确。

同一 clientRequestId 重复提交不能再调用一次模型；返回已有 runId 和查询入口。活动运行限制需数据库约束或事务保证，不能只禁用发送按钮。

验收用 MockAdapter 稳定复现：正常、慢速、中文跨块、空输出、生成中失败、超时、取消、超长回答和畸形供应商响应。

## 9. 知识库与 RAG 设计

文档处理流程：校验 → 保存待处理版本并创建 job（同一事务）→ worker 获取任务 → 文本切分 → 批量 embedding → 写入 chunks → 将版本置 ready → 原子切换 active_version_id。

worker 使用任务租约、超时回收和有限重试。网络超时/限流可指数退避重试，首版最多 3 次；格式不支持等确定性错误不自动重试。重复执行同一个任务不产生重复 chunks。

分块起点：优先按标题、段落切分，目标每块约 400～800 中文字符，重叠约 80 字，超长段落再切分；这是待评测调整的初始参数。记录原文偏移和标题路径。embedding 输入另按供应商 token 限制验证。

问答流程：

1. 根据登录态验证工作区与会话归属。
2. 将问题转为向量。
3. SQL 先限定本工作区、未删除、当前就绪版本，再取相似片段。
4. 初期精确向量检索，topK 从 5 开始；不先堆向量索引或 reranker。
5. 通过开发集调整阈值，过滤明显不相关片段；阈值不是跨模型通用的置信度。
6. 将片段编号连同必要的近期对话放入 prompt，控制上下文长度。
7. 要求回答引用片段编号，没有支持信息时说明并建议建工单。
8. 服务端只接受实际检索到的来源 ID；检查编号有效性，并保存来源快照。

引用编号有效不等于内容真实，因此“引用是否支持结论”仍要人工评测。知识库文本视为资料，不视为系统指令；文档中的“忽略规则”等内容不能赋予模型执行权限。

版本规则：新版本处理期间旧版本可继续使用；新版本成功后原子切换，失败不影响旧版本。删除后立即排除后续检索；已加载该文档的活动运行取消或在输出前失效检查。历史引用保留版本快照，仅对仍有权限的用户展示并标注“历史版本”；删除文档后引用入口显示“来源已删除”，不再返回其快照正文。已生成回答可能含旧内容，这是历史记录，不宣称删除能撤回已经显示的信息。

## 10. AI 工单草稿与确认

首版使用明确的“生成工单草稿”按钮触发结构化生成，不要求实现通用 Agent 循环。后续可以接入模型工具调用，复用同一草稿和确认接口。

模型仅生成 title、description、priority、suggestedCategory；不允许模型决定 workspace_id、created_by、最终负责人或授权。结构不合法时最多纠正重试一次，仍失败则展示普通手动创建入口。

草稿卡片允许编辑标题、描述、优先级、负责人。负责人只能从服务端返回的本工作区成员中选择。草稿的服务端状态为 pending/confirmed/cancelled/expired，执行中状态由前端请求态表示。

确认事务：验证当前用户、工作区、草稿归属、权限、version 和有效期 → 验证幂等键及请求摘要 → 锁定/条件更新草稿 → 创建工单 → 写审计日志 → 标记 confirmed 与 ticket_id → 保存幂等响应 → 提交。

相同 key、相同请求返回相同结果；相同 key、不同请求返回 409。不同 key 重复确认同一草稿也不能产生第二张工单，需要草稿级唯一约束/锁保证。超时重试前端继续使用原 key。

## 11. 测试、评测与观测

### 自动测试

| 层级 | 必测案例 |
|---|---|
| 单元 | 状态迁移、权限策略、输入校验、SSE 分片解析、引用映射 |
| 组件 | 输入法、滚动跟随、停止/重试、草稿编辑及只读状态 |
| 数据库集成 | 工作区隔离、事务回滚、并发确认、乐观锁、worker 重复执行、版本切换 |
| E2E | 登录建单、工单处理、上传文档、带引用问答、确认草稿、访客禁止写入 |

集成测试用真实 PostgreSQL + pgvector，不能只 mock 数据访问。CI 默认使用 MockAdapter，避免真实模型结果不确定和产生费用。真实模型评测手动触发。

### AI 评测集

准备一个虚构软件产品的 10～15 份资料：账号、权限、订阅、导入限制、错误码、安装排查、版本变化等。全部使用虚构客户与案例。

先写 40 个标注问题：直接命中 12、跨段组合 8、无答案 8、版本冲突 6、文档提示注入 6。另设工作区隔离集成测试，不用回答文本判断隔离是否成立。

用 25 个问题开发调参、15 个问题作为保留集，不根据保留集反复调参数；按问题类型分层划分。数据记录 question、expectedSources、requiredFacts、shouldAbstain、category。

报告指标：检索命中率、事实符合预期比例、引用支持率、无答案时正确拒答比例、端到端耗时、首个文本分片耗时、token 用量。小样本同时报告分子/分母，不能只给百分比。

初始目标：有答案问题的检索命中率 ≥85%，无答案问题正确拒答比例 ≥80%，跨工作区数据泄露测试 0 失败。样本很小，这些只是项目内部门槛，不代表生产能力；模型答复不达标则如实记录并分析。

同一版本运行多次观察波动，记录模型标识、日期、prompt 版本、检索参数、代码提交。不同供应商或参数的结果不能混作同一实验。费用有可靠价格配置才估算，否则只报告 token。

### 性能与日志

- 工单列表用 1 万条种子数据测试；本地固定环境下普通 API p95 目标小于 500ms，报告硬件、并发、样本数和冷热启动条件。
- AI 首字延迟只记录实测分布，不承诺固定数字；设置上游超时和总请求时长上限。
- 长会话用 200 条消息检查滚动、内存和重渲染；有测量证据再引入虚拟列表。
- 日志携带 requestId/runId/workspaceId、耗时及错误码；默认不记录密码、密钥、完整会话正文或文档。
- AI 接口设置单用户速率限制、并发限制、输入输出长度上限；有全局日预算/调用上限和关闭真实调用开关。

## 12. 按顺序执行的任务清单

以下每项建议建立一个 GitHub Issue。S 约 1～3 小时、M 约 4～8 小时、L 约 8～12 小时，均为粗估，学习和返工可能显著增加时间。单人按依赖顺序做，不把所有任务同时标为进行中。

| ID | 任务与产物 | 依赖 | 估算 | 验收标准 |
|---|---|---|---|---|
| P01 | 产品范围、权限表、6 个页面线框图 | 无 | S | 能按线框讲完完整流程 |
| P02 | 仓库、前后端、contracts、lint/typecheck | P01 | M | 一个命令启动开发服务，CI 通过 |
| P03 | 数据库迁移和双工作区种子数据 | P02 | M | 新数据库可重复初始化 |
| P04 | 登录、Cookie 会话、工作区鉴权 | P03 | M | 登录/过期/登出/越权测试通过 |
| P05 | 工单 CRUD、分页筛选、乐观锁 | P04 | L | 列表可分享筛选链接，冲突有反馈 |
| P06 | 状态机、备注、审计和事务 | P05 | M | 非法迁移拒绝，合法操作留下历史 |
| P07 | 首次 Docker 部署与演示数据 | P06 | M | 干净环境能启动并完成建单 |
| P08 | AI Provider 接口和可控 MockAdapter | P02 | M | 可稳定模拟慢速、失败、取消 |
| P09 | 会话、消息、运行记录 API | P04,P08 | M | 刷新能恢复已保存消息 |
| P10 | POST 流协议、取消、快照和终态 | P09 | L | 多种分片/取消竞争/断线测试通过 |
| P11 | Vue 消息区、滚动、Markdown、输入法 | P10 | L | 异常和长会话交互可用 |
| P12 | 一个真实模型适配器与限流 | P10 | M | 密钥不进入浏览器，超时可处理 |
| P13 | 文档 API、任务 worker 与重试 | P03,P04 | L | 重启后任务可回收，不重复入库 |
| P14 | 切分、embedding、向量查询 | P12,P13 | L | 只检索当前工作区有效版本 |
| P15 | 引用、无依据处理、版本切换 | P11,P14 | L | 引用可定位，删除/更新符合约定 |
| P16 | 固定数据集与第一份评测基线 | P15 | M | 保存可复现实验配置与结果 |
| P17 | 工单草稿结构化输出与编辑卡片 | P06,P11,P12 | M | 无效输出可退回手动创建 |
| P18 | 草稿确认事务、幂等与权限 | P17 | L | 并发多次提交仍只创建一张单 |
| P19 | E2E、跨工作区/注入/异常回归 | P15,P18 | L | 关键回归集全部通过 |
| P20 | 性能测量与一次有证据的优化 | P19 | M | 报告前后条件与结果 |
| P21 | 试用、反馈记录与修复 | P19 | M | 真实反馈可追溯，无虚构指标 |
| P22 | README、架构图、复盘、演示视频 | P20,P21 | M | 陌生人能启动并理解项目 |

这些任务约 130～180 小时，另预留约 20% 缓冲。每周投入 15 小时，按约 11～15 周安排更稳妥；已有后端经验可以压缩。每周只有 10 小时则顺延，不靠删除异常处理来追赶日期。

里程碑：M1=P01～P07 工单可用；M2=P08～P12 AI 交互可用；M3=P13～P16 问答有依据；M4=P17～P19 端到端可靠；M5=P20～P22 可展示、可解释、可复现。

## 13. 每个 Issue 的工作方式与 AI 协作

Issue 模板：用户故事、范围、API/状态变化、实现步骤、异常情况、验收方式。PR 模板：解决什么问题、核心取舍、截图/录屏、测试证据、已知限制。

开发循环：先写验收 → 让 AI 阅读现有结构并给最小方案 → 你确认数据流和边界 → 实现小范围变更 → 运行对应检查 → 人工走一遍 → 更新文档 → 提交。

可以交给 AI：页面骨架、DTO、种子数据、已有规范下的重复 CRUD、测试样例草稿、文档初稿。必须自己核对：权限隔离、事务、并发、流式终态、数据库变更、模型工具执行边界。

可复制给编码助手的任务格式：

> 请实现任务 Pxx。先阅读仓库说明和相关模块，列出受影响文件与关键边界，再实现最小完整改动。遵守 docs 中的权限、状态和 API 约定。不要加入无关依赖或下一阶段功能。为本任务的风险编写必要测试，运行 lint/typecheck 及相关测试，最后说明改动、验证结果与仍未解决的问题。

每完成一个任务，你应能独立解释：数据从哪里来、在哪里校验、失败如何恢复、为什么选这个实现。如果解释不清，先复查再合并。

## 14. 发布与作品集交付

CI：安装锁定依赖 → lint → typecheck → 单元/组件测试 → 数据库集成测试 → build → Mock 模式 E2E。发布前另运行一次真实模型冒烟与评测。

部署包含 web 产物/代理、api、worker、PostgreSQL，配置 HTTPS、持久卷、健康检查、数据库备份。做一次备份恢复演练；迁移先备份，说明回滚限制。

公开演示默认使用模拟 AI 和虚构数据，显著标记；访客可查看。需要体验写入时创建短期隔离演示工作区并限制资源，或者使用受限独立演示账号和重置机制。不要开放无上限真实模型请求。真实模型模式由环境变量配置，在本地或受控账号演示。

GitHub 最终材料：

- README：一句话定位、截图、演示链接、模拟模式说明、启动步骤、技术栈、限制。
- docs/architecture.md：架构、数据流、权限边界、状态机。
- docs/decisions/：为什么用 POST 流、为什么先精确检索、为什么需要幂等。
- evals/reports/：固定评测结果与失败案例。
- docs/troubleshooting/：至少两次真实修复记录，不能编造问题和收益。
- 2～3 分钟录屏：登录 → 提问 → 看来源 → 建工单 → 改状态 → 展示一次失败恢复。
- LICENSE：选择适合自己的开源许可，列明第三方依赖与素材来源。
- .env.example：只有占位值；无真实密钥、客户数据或私人文件。

简历描述模板（只填写真实结果）：

> 独立开发基于 Vue 3、NestJS、PostgreSQL 的 AI 客服与工单工作台，实现知识库检索、流式问答、来源定位和人工确认建单；通过运行状态管理、事务与幂等控制处理取消、断线和重复提交；基于 N 条固定样例评测并记录检索、引用和拒答表现。

## 15. 开工第一天

1. 确认虚构产品名称和客服场景，固定第一版范围。
2. 把本文保存到仓库 docs/project-plan.md，创建 P01～P07 的 Issue。
3. 画工单列表、工单详情、AI 工作台的低保真线框，不先追求视觉细节。
4. 初始化 Vue/NestJS workspace、PostgreSQL Compose、.env.example。
5. 跑通前端请求 /api/health，提交首个能启动的版本。

第一周只要求工单基础闭环开始可用。不要把第一周全部花在聊天动画、模型排行榜或组件库包装上。

## 16. 官方参考资料

- [MDN：SSE 的事件格式与连接处理](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)。本文的事件名和运行状态是项目自定义协议。
- [pgvector：检索、过滤与索引](https://github.com/pgvector/pgvector)。小规模知识库先以精确检索建立基线，再根据数据量和测量结果考虑索引。
- [PostgreSQL：行级安全策略](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)。用于理解后续数据库隔离增强，首版仍需完成应用授权与隔离测试。
