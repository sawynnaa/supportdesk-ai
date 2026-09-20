import 'dotenv/config';
import { db } from '../apps/api/src/db.js';
import { seed } from '../apps/api/src/seed.js';
await db.init();
await seed(db);
await db.close();
console.log('种子数据已创建（重复执行不会覆盖现有数据）');
