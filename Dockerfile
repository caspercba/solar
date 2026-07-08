# Local dev image: mock or Miniflare Worker + static frontend server
FROM node:20-alpine

WORKDIR /app

# Install worker + e2e dependencies (serve, wrangler, mock fixtures)
COPY worker/package.json worker/package-lock.json ./worker/
COPY e2e/package.json e2e/package-lock.json ./e2e/
RUN cd worker && npm ci && cd ../e2e && npm ci

COPY . .

RUN chmod +x scripts/docker-api-entry.sh scripts/docker-frontend-entry.sh

EXPOSE 8080 8787
