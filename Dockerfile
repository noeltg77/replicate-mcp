FROM node:20-alpine as builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY *.ts ./

RUN npm install
RUN npm run build

FROM node:20-alpine AS release

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

ENV NODE_ENV=production

RUN npm ci --omit=dev

ENTRYPOINT ["node", "dist/index.js"]
