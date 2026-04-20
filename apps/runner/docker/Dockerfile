FROM node:22-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io git openssl ca-certificates \
  && npm install -g @openai/codex \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json next-env.d.ts ./

RUN npm ci \
  && npm cache clean --force
RUN npx playwright install --with-deps chromium \
  && npm cache clean --force \
  && chmod -R 755 /ms-playwright

CMD ["npm", "run", "runner:start"]
