import 'reflect-metadata';
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { db } from './db.js';
import { seed } from './seed.js';
import { createRouter } from './http.js';
import { startWorker } from '../../worker/src/jobs.js';
@Module({})
class AppModule {}
await db.init();
if (process.env.SEED_DEMO !== 'false') await seed(db);
const app = await NestFactory.create(AppModule, { bodyParser: false });
app.use('/api', createRouter(db));
const webRoot = path.resolve('dist/web');
if (existsSync(webRoot)) {
  app.use(express.static(webRoot));
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) res.sendFile(path.join(webRoot, 'index.html'));
    else next();
  });
}
const stop = process.env.EXTERNAL_WORKER === 'true' ? () => {} : startWorker(db);
await app.listen(Number(process.env.PORT || 3001), '0.0.0.0');
console.log(`SupportDesk API ready: http://localhost:${process.env.PORT || 3001}`);
async function shutdown() {
  stop();
  await app.close();
  await db.close();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
