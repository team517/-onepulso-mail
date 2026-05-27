FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build con más memoria para evitar OOM en next build (especialmente Turbopack)
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
# Heap más grande en runtime para schedulers + IMAP sync de muchas cuentas
ENV NODE_OPTIONS="--max-old-space-size=3072 --expose-gc"

CMD ["npm", "start"]
