import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { Database } from '../../apps/api/src/db.js';
import { seed } from '../../apps/api/src/seed.js';
import { processJob } from '../../apps/worker/src/jobs.js';
import { retrieve, answer, modelName, embeddingName, realMode } from '../../apps/api/src/ai.js';
import { readFile } from 'node:fs/promises';
const split = process.argv.includes('--holdout') ? 'holdout' : 'dev';
if (realMode() && !process.argv.includes('--real'))
  throw new Error('真实模型评测须显式传入 --real，以确认调用成本。');
delete process.env.DATABASE_URL; // Always isolate measurements from application data.
process.env.DATA_DIR = ':memory:';
const db = new Database();
await db.init();
await seed(db);
while (await processJob(db)) {
  /* prepare corpus */
}
const dataset = JSON.parse(await readFile('evals/datasets/flowspace-v1.json', 'utf8')).filter(
  (r: any) => r.split === split,
);
const results = [];
for (const row of dataset) {
  const start = performance.now();
  const sources = await retrieve(db, 'ws-demo', row.question);
  const retrievalMs = performance.now() - start;
  let content = '',
    firstDeltaMs: number | null = null;
  for await (const token of answer(row.question, sources, 'normal', new AbortController().signal)) {
    if (firstDeltaMs === null) firstDeltaMs = performance.now() - start;
    content += token;
  }
  const retrieved = sources.map((s) => s.document_id);
  const cited = [...content.matchAll(/\[(\d+)\]/g)].map((m) => m[1]);
  results.push({
    ...row,
    retrieved,
    retrievalHit: row.expectedSources.every((s: string) => retrieved.includes(s)),
    requiredFactsPresent: row.requiredFacts.every((f: string) => content.includes(f)),
    abstained: content.includes('没有足够资料') || content.includes('无法确认'),
    citationsValid: cited.every((l) => sources.some((s) => s.label === l)),
    retrievalMs,
    firstDeltaMs,
    durationMs: performance.now() - start,
    content,
  });
}
const answerable = results.filter((r) => !r.shouldAbstain),
  abstain = results.filter((r) => r.shouldAbstain);
const metric = (a: any[], predicate: (r: any) => boolean) => `${a.filter(predicate).length}/${a.length}`;
const report = {
  date: new Date().toISOString(),
  model: modelName(),
  embeddingModel: embeddingName(),
  mode: realMode() ? 'real' : 'mock',
  split,
  promptVersion: 'v1',
  topK: 5,
  threshold: realMode() ? 0.3 : 0.19,
  platform: `${os.platform()} ${os.arch()}`,
  node: process.version,
  metrics: {
    retrievalHit: metric(answerable, (r) => r.retrievalHit),
    requiredFactsStringMatch: metric(answerable, (r) => r.requiredFactsPresent),
    correctAbstention: metric(abstain, (r) => r.abstained),
    validCitationIdentifiers: metric(results, (r) => r.citationsValid),
    citationSupport: '需要人工逐条审阅；编号有效不等于支持结论',
    tokens: 'Mock 无 token；真实模式见运行用量记录',
  },
  results,
};
await mkdir('evals/reports', { recursive: true });
const name = process.env.REPORT_NAME || `baseline-${split}`;
await writeFile(`evals/reports/${name}.json`, JSON.stringify(report, null, 2));
await writeFile(
  `evals/reports/${name}.md`,
  `# ${split} 评测记录\n\n日期：${report.date}。模型：${report.model}。Embedding：${report.embeddingModel}。Prompt v1，topK=5。\n\n这是${realMode() ? '真实调用' : '确定性 Mock'}测试，不能用来宣称真实模型质量。事实采用字符串匹配初筛，引用支持仍须人工评审。\n\n|指标|实测分子/分母|\n|---|---|\n|有答案样例检索覆盖全部期望来源|${report.metrics.retrievalHit}|\n|必要事实字符串命中|${report.metrics.requiredFactsStringMatch}|\n|无答案正确拒答|${report.metrics.correctAbstention}|\n|引用编号合法|${report.metrics.validCitationIdentifiers}|\n\n完整输出和耗时见同名 JSON。未进行人工语义事实与引用支持评审。未估算费用。数据集中的 injection 类目前为问题侧攻击，文档侧注入由集成测试补充。\n`,
);
console.log(JSON.stringify(report.metrics, null, 2));
await db.close();
