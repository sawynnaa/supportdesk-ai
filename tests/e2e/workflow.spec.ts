import { test, expect } from '@playwright/test';
async function login(page: any, role = 'admin') {
  await page.goto('/login');
  await page.getByLabel('邮箱地址').fill(role + '@demo.com');
  await page.getByLabel('密码', { exact: true }).fill('Demo123456!');
  await page.getByRole('button', { name: '登录工作区', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets/);
}
test('login, create, assign, comment and resolve a ticket', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '创建工单', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = '端到端工单 ' + Date.now();
  await dialog.getByLabel('工单标题').fill(title);
  await dialog.getByLabel('问题描述').fill('CSV 导入失败，已检查 UTF-8 编码，需要继续排查。');
  await dialog.getByLabel('负责人').selectOption('agent');
  await dialog.getByRole('button', { name: '创建工单', exact: true }).click();
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.getByRole('button', { name: '开始处理', exact: true }).click();
  await expect(page.locator('.detail-kicker')).toContainText('处理中');
  await page.getByPlaceholder('添加内部备注，仅工作区成员可见…').fill('已确认客户环境，等待验证修复。');
  await page.getByRole('button', { name: '添加备注', exact: true }).click();
  await expect(page.locator('.comment')).toContainText('已确认客户环境');
  await page.getByRole('button', { name: '标记已解决', exact: true }).click();
  await page.getByRole('button', { name: '关闭工单', exact: true }).click();
  await expect(page.locator('.detail-kicker')).toContainText('已关闭');
});
test('AI source, refresh recovery and confirmed draft', async ({ page }) => {
  await login(page);
  await page.goto('/assistant');
  await page.getByRole('button', { name: 'CSV 数据导入失败 了解导入限制与排查步骤' }).click();
  await expect(page.locator('.message-status').last()).toHaveText('已完成', { timeout: 30000 });
  await page.getByRole('button', { name: /1 CSV 数据导入指南/ }).click();
  await expect(page.getByRole('dialog', { name: '引用来源' })).toContainText('5000');
  await page.getByRole('button', { name: 'Close this dialog' }).click();
  await page.reload();
  await expect(page.locator('.messages')).toContainText('5000');
  await page.getByRole('button', { name: '生成工单草稿', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认工单草稿' })).toBeVisible();
  await page.getByRole('button', { name: '确认并创建工单', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/.+/);
  await expect(page.locator('.detail-heading')).toContainText('来自 AI 会话');
});
test('admin uploads a knowledge document', async ({ page }) => {
  await login(page);
  await page.goto('/knowledge');
  await page.getByRole('button', { name: '上传文档', exact: true }).click();
  const d = page.getByRole('dialog');
  const title = '端到端知识文档 ' + Date.now();
  await d.getByLabel('文档标题').fill(title);
  await d.getByLabel('文档内容').fill('# 测试知识\n\n这是虚构测试资料，客服将在一个工作日内回复。');
  await d.getByRole('button', { name: '上传并处理' }).click();
  const card = page.locator('.document-card').filter({ hasText: title });
  await expect(card).toContainText('已就绪', { timeout: 20000 });
  await card.getByRole('link', { name: title }).click();
  await expect(page.locator('.document-body')).toContainText('一个工作日');
});
test('viewer has read-only UI and API', async ({ page }) => {
  await login(page, 'viewer');
  await expect(page.getByRole('button', { name: '创建工单', exact: true })).toHaveCount(0);
  await page.goto('/assistant');
  await expect(page.getByText('访客暂不支持 AI 会话')).toBeVisible();
  await page.goto('/knowledge');
  await expect(page.getByRole('button', { name: '上传文档', exact: true })).toHaveCount(0);
});
test('mock failure and stop are recoverable', async ({ page }) => {
  await login(page);
  await page.goto('/assistant');
  await page.getByLabel('模拟场景').selectOption('failure');
  await page.getByLabel('客户问题').fill('CSV 数据导入有什么限制？');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('模拟生成中断');
  await page.getByLabel('模拟场景').selectOption('slow');
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.locator('.message-status').last()).toHaveText('已取消');
});
