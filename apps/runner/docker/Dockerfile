FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json next-env.d.ts ./

RUN npm install

CMD ["npm", "run", "runner:start"]
