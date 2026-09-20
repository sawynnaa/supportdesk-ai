import bcrypt from 'bcryptjs';
import type { Database } from './db.js';
import { id, hash } from './domain.js';
export const knowledgeSeed = [
  {
    slug: 'account',
    title: '账号登录与密码重置',
    body: '# 账号登录与密码重置\n\nFlowSpace 支持邮箱和密码登录。连续 5 次输错密码将锁定 15 分钟。\n\n## 找回密码\n点击登录页的「忘记密码」，输入注册邮箱。重置链接有效期为 30 分钟，使用后立即失效。如果没有收到邮件，请检查垃圾邮件和企业邮箱过滤规则。\n\n## 登录排查\n请确认邮箱无多余空格，并清除浏览器缓存。重置后仍不能登录时，请提供注册邮箱、错误提示和发生时间，由管理员排查。不要向客服提供密码。',
  },
  {
    slug: 'permissions',
    title: '工作区成员与权限说明',
    body: '# 工作区成员与权限说明\n\nFlowSpace 的工作区有管理员、编辑者和访客三个角色。管理员可以管理成员和工作区设置。编辑者可以创建和编辑项目，访客只能查看已授权项目。\n\n只有管理员可以邀请成员：设置 → 成员管理 → 邀请成员。邀请链接有效期为 7 天。不同工作区的项目和成员相互隔离。',
  },
  {
    slug: 'import',
    title: 'CSV 数据导入指南',
    body: '# CSV 数据导入指南\n\nFlowSpace 支持 UTF-8 编码的 CSV 文件导入。单个文件最大 10 MB，最多 5000 行。第一行必须是表头，名称列为必填项。\n\n## 导入失败排查\n如果遇到「文件格式不支持」，请将 Excel 另存为 CSV UTF-8 格式，检查表头和必填字段，移除合并单元格。超过 5000 行的数据需要分批导入。\n\n导入前可预览前 20 行。重复记录根据唯一 ID 更新，没有 ID 则新建。导入任务失败不会覆盖已有数据。',
  },
  {
    slug: 'subscription',
    title: '订阅方案与套餐升级',
    body: '# 订阅方案与套餐升级\n\nFlowSpace 提供免费版、专业版和团队版。免费版包含 3 个项目、2 名成员和 1 GB 存储；专业版包含 50 个项目、10 名成员和 50 GB 存储；团队版包含无限项目、50 名成员和 500 GB 存储。\n\n管理员可在设置 → 订阅管理升级套餐。升级立即生效，剩余账期按差价计算；降级在下个账期生效。所有价格以订阅页面展示为准。',
  },
  {
    slug: 'billing',
    title: '发票申请与账单查询',
    body: '# 发票申请与账单查询\n\n管理员可进入设置 → 账单中心查看账单，下载支付凭证。付款完成后可以申请电子普通发票，需要填写抬头、税号和接收邮箱。\n\n发票通常在 3 个工作日内发送至填写的邮箱。开票信息有误时请联系人工客服，提供订单编号。退款须人工审核，客服助手不能直接退款。',
  },
  {
    slug: 'e403',
    title: '错误码 E403：访问权限不足',
    body: '# 错误码 E403：访问权限不足\n\nE403 表示当前账号没有访问目标项目的权限。请先确认所在工作区正确，再联系工作区管理员检查项目授权。\n\n如果刚调整权限，请退出并重新登录。权限变更最长可能需要 5 分钟生效。请勿通过分享他人的会话令牌绕过权限。',
  },
  {
    slug: 'e502',
    title: '错误码 E502：服务连接异常',
    body: '# 错误码 E502：服务连接异常\n\nE502 表示客户端暂时无法连接 FlowSpace 服务。请检查网络，等待 1 分钟后重试。企业网络下可尝试关闭代理，或联系 IT 检查防火墙。\n\n持续超过 10 分钟时，记录错误码、发生时间、操作步骤和客户端版本并提交工单。不要反复重复提交导入任务。',
  },
  {
    slug: 'install',
    title: '桌面客户端安装与更新',
    body: '# 桌面客户端安装与更新\n\nFlowSpace 桌面端支持 Windows 10 及以上、macOS 12 及以上。请从产品官网下载对应系统安装包。\n\nmacOS 提示无法打开时，在系统设置 → 隐私与安全性中确认安装来源。Windows 安装失败时请检查磁盘空间，至少保留 500 MB。应用内「关于 → 检查更新」可手动更新。',
  },
  {
    slug: 'sync',
    title: '多设备同步与离线编辑',
    body: '# 多设备同步与离线编辑\n\n联网时 FlowSpace 每 30 秒自动同步一次。离线编辑内容先保存在当前设备，恢复网络后自动上传。\n\n同一条记录发生并发修改时会显示冲突提示，请选择需要保留的版本。不要清除浏览器站点数据，以免丢失未同步内容。',
  },
  {
    slug: 'export',
    title: '数据导出与备份',
    body: '# 数据导出与备份\n\n管理员和编辑者可在项目菜单选择「导出 CSV」。单次导出最多 10000 条记录，超出时请按日期分批导出。\n\n导出文件包含当前视图的字段，附件需要单独下载。工作区每日备份一次，保留 7 天；恢复请求请由管理员提交工单。',
  },
  {
    slug: 'versions',
    title: 'v2.4 版本更新说明',
    body: '# v2.4 版本更新说明\n\nFlowSpace v2.4 将 CSV 导入上限从旧版 v2.3 的 2000 行提高到 5000 行，文件大小仍为 10 MB。当前文档以 v2.4 为准。\n\n新版本增加了导入预览、冲突提示和批量标签。升级不会删除已有项目数据。旧桌面端请先更新再尝试新功能。',
  },
  {
    slug: 'security',
    title: '安全设置与双重验证',
    body: '# 安全设置与双重验证\n\n用户可在个人设置 → 账号安全开启 TOTP 双重验证。绑定验证器后需要保存恢复码，恢复码仅展示一次。\n\n丢失验证器时可使用恢复码登录。验证器和恢复码都丢失时，请联系人工客服进行账号归属验证。客服不会索要密码或验证码。',
  },
];
export async function seed(db: Database) {
  const hashPassword = await bcrypt.hash(process.env.DEMO_PASSWORD || 'Demo123456!', 10);
  await db.transaction(async (tx) => {
    for (const [uid, email, name] of [
      ['admin', 'admin@demo.com', '林晓'],
      ['agent', 'agent@demo.com', '陈默'],
      ['viewer', 'viewer@demo.com', '访客'],
      ['other', 'other@demo.com', '测试成员'],
    ])
      await tx.query(
        'INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [uid, email, hashPassword, name],
      );
    for (const [wid, name] of [
      ['ws-demo', 'FlowSpace 客户支持'],
      ['ws-other', 'Northstar 独立工作区'],
    ])
      await tx.query('INSERT INTO workspaces(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [wid, name]);
    for (const [wid, uid, role] of [
      ['ws-demo', 'admin', 'admin'],
      ['ws-demo', 'agent', 'agent'],
      ['ws-demo', 'viewer', 'viewer'],
      ['ws-other', 'admin', 'admin'],
      ['ws-other', 'other', 'agent'],
    ])
      await tx.query(
        'INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [wid, uid, role],
      );
    const titles = [
      '客户无法收到密码重置邮件',
      'CSV 文件导入失败，提示编码错误',
      '团队版升级后成员数量未更新',
      '邀请链接打开后提示已过期',
      '桌面客户端登录后出现白屏',
      '申请补开九月订阅发票',
      '项目数据同步延迟',
      '如何批量导出历史项目数据',
      '权限变更后仍无法访问项目',
      'macOS 安装包无法正常打开',
      '协助配置账号双重验证',
      '导入数据出现重复记录',
    ];
    for (let i = 0; i < titles.length; i++)
      await tx.query(
        `INSERT INTO tickets(id,workspace_id,title,description,priority,status,assignee_id,created_by,created_at,updated_at) VALUES($1,'ws-demo',$2,$3,$4,$5,$6,'admin',now()-($7::text||' hours')::interval,now()-($8::text||' minutes')::interval) ON CONFLICT DO NOTHING`,
        [
          `seed-ticket-${i + 1}`,
          titles[i],
          `客户反馈：${titles[i]}。\n\n产品：FlowSpace v2.4\n环境：Chrome / macOS\n复现步骤：按产品正常流程操作后出现异常，已建议客户检查基础设置。\n\n请协助核实原因并提供处理方案。`,
          [
            'high',
            'high',
            'medium',
            'medium',
            'high',
            'low',
            'medium',
            'low',
            'medium',
            'medium',
            'low',
            'low',
          ][i],
          [
            'open',
            'in_progress',
            'open',
            'open',
            'in_progress',
            'resolved',
            'in_progress',
            'resolved',
            'open',
            'closed',
            'closed',
            'closed',
          ][i],
          i % 3 === 0 ? null : i % 2 ? 'agent' : 'admin',
          i * 4 + 1,
          i * 17 + 5,
        ],
      );
    await tx.query(
      "INSERT INTO tickets(id,workspace_id,title,description,priority,created_by) VALUES('other-ticket','ws-other','独立工作区的私有工单','这份数据不属于 FlowSpace 工作区。','medium','other') ON CONFLICT DO NOTHING",
    );
    for (const doc of knowledgeSeed) {
      const did = `doc-${doc.slug}`,
        vid = `ver-${doc.slug}-1`;
      const [exists] = await tx.query('SELECT id FROM documents WHERE id=$1', [did]);
      if (exists) continue;
      await tx.query("INSERT INTO documents(id,workspace_id,title) VALUES($1,'ws-demo',$2)", [
        did,
        doc.title,
      ]);
      await tx.query(
        "INSERT INTO document_versions(id,workspace_id,document_id,version_no,body,content_hash) VALUES($1,'ws-demo',$2,1,$3,$4)",
        [vid, did, doc.body, hash(doc.body)],
      );
      await tx.query(
        "INSERT INTO jobs(id,workspace_id,type,payload) VALUES($1,'ws-demo','document.embed',$2::jsonb)",
        [id(), JSON.stringify({ versionId: vid })],
      );
    }
  });
}
