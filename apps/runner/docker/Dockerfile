FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.123.0
ARG TARGETARCH

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY docker/install-codex-runtime.sh /tmp/install-codex-runtime.sh
RUN chmod +x /tmp/install-codex-runtime.sh \
  && /tmp/install-codex-runtime.sh \
  && rm /tmp/install-codex-runtime.sh

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY docker/install-playwright-chromium.sh /tmp/install-playwright-chromium.sh
COPY tsconfig.json next-env.d.ts ./

RUN npm ci \
  && npm cache clean --force
RUN chmod +x /tmp/install-playwright-chromium.sh \
  && /tmp/install-playwright-chromium.sh \
  && rm /tmp/install-playwright-chromium.sh

CMD ["npm", "run", "runner:start"]
