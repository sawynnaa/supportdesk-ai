# 部署与恢复

## 本地独立 PostgreSQL

使用包含 pgvector 的 PostgreSQL 17。创建空数据库，在运行环境注入 `DATABASE_URL`，然后 `pnpm start`。首次启动执行幂等 SQL 初始结构；生产迁移须审核 SQL 并先备份。`schema.prisma` 用于生成客户端，复合外键、CHECK、局部唯一索引、vector 扩展由 SQL 管理。

## Docker Compose

本机需先安装 Docker。项目没有预填数据库生产密码；在你的终端中自行设置 `POSTGRES_PASSWORD` 与 `DEMO_PASSWORD`，然后：

```sh
docker compose -f infra/compose.yaml up --build -d
```

访问 http://localhost:8080 。默认只绑定本机回环地址，不会自动公开到互联网。容器包含 API、worker、Nginx 与 PostgreSQL 持久卷。默认 AI 始终为模板模式，Compose 不注入任何 Key。

公开部署需要独立环境、域名与 HTTPS，在反向代理配置证书和 `APP_ORIGIN`，设置 `NODE_ENV=production` 开启 Secure Cookie。修改端口绑定前明确演示账号权限，使用隔离数据与资源额度。不要把开发演示密码和可写管理员账号直接公开。

## 备份与恢复演练说明

下面是供目标部署环境执行的步骤，**本次未执行 PostgreSQL 备份恢复演练**：

```sh
docker compose -f infra/compose.yaml exec -T db pg_dump -U supportdesk -Fc supportdesk > backup.dump
# 在单独的演练数据库恢复，禁止直接覆盖生产库。
docker compose -f infra/compose.yaml exec -T db createdb -U supportdesk supportdesk_restore
docker compose -f infra/compose.yaml exec -T db pg_restore -U supportdesk -d supportdesk_restore < backup.dump
```

核对 users、tickets、messages、documents、chunks、jobs 数量及抽样引用；在演练实例重放测试，再记录时间和结果。备份可能包含业务正文，不提交到仓库。

PGlite 本地备份应先停止服务，再完整复制 `.data/supportdesk`。运行中的目录复制不保证一致性。不要让 API 和单独 worker 同时打开该目录。

迁移只提供初始版本，不承诺任意 SQL 的自动回滚。数据破坏型修改需要可恢复备份和人工验证。

## CI

GitHub Actions 分别运行 PGlite 测试、PostgreSQL+pgvector 测试、构建和 Playwright。CI 自带的是临时测试数据库密码，与模型 Key 无关。此文件只是已提供的流水线配置；在推送到实际远程仓库前，没有所谓“线上 CI 已绿”的结果。
