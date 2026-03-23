FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
COPY ../../shared /shared
CMD ["npx", "tsx", "src/index.ts"]