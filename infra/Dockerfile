FROM node:22.22.0-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/server/apps/api/src/main.js"]
