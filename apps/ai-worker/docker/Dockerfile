FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV CODEX_BIN=codex

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    bubblewrap \
    ca-certificates \
    coreutils \
    curl \
    git \
    less \
    openssh-client \
    procps \
    python3 \
    python3-pip \
    ripgrep \
    unzip \
  && npm install -g @openai/codex \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json next-env.d.ts ./

RUN npm ci \
  && npm cache clean --force

CMD ["npm", "run", "ai-worker:start"]
