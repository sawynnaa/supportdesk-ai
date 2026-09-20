import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import pg from 'pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
export interface Sql {
  prisma?: Prisma.TransactionClient;
  query<T = any>(sql: string, args?: any[]): Promise<T[]>;
}
export class Database implements Sql {
  private local?: PGlite;
  private pool?: pg.Pool;
  prisma?: PrismaClient;
  async init() {
    if (process.env.DATABASE_URL) this.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    else {
      const dir = process.env.DATA_DIR || '.data/supportdesk';
      if (dir !== ':memory:') await mkdir(path.resolve(dir), { recursive: true });
      this.local = new PGlite({
        dataDir: dir === ':memory:' ? undefined : path.resolve(dir),
        extensions: { vector },
      });
      await this.local.waitReady;
    }
    const sql = await readFile(path.resolve('prisma/migrations/001_initial/migration.sql'), 'utf8');
    if (this.pool) {
      await this.pool.query(sql);
      await this.pool.end();
      this.pool = undefined;
      this.prisma = new PrismaClient();
      await this.prisma.$connect();
    } else await this.local!.exec(sql);
  }
  async query<T = any>(sql: string, args: any[] = []): Promise<T[]> {
    return this.prisma
      ? this.prisma.$queryRawUnsafe<T[]>(sql, ...args)
      : (await this.local!.query<T>(sql, args)).rows;
  }
  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    if (this.local)
      return this.local.transaction((tx) =>
        fn({ query: async <R = any>(s: string, a: any[] = []) => (await tx.query<R>(s, a)).rows }),
      );
    return this.prisma!.$transaction(
      async (tx) =>
        fn({ prisma: tx, query: <R = any>(s: string, a: any[] = []) => tx.$queryRawUnsafe<R[]>(s, ...a) }),
      { maxWait: 10000, timeout: 30000 },
    );
  }
  async close() {
    if (this.prisma) await this.prisma.$disconnect();
    if (this.local) await this.local.close();
  }
}
export const db = new Database();
