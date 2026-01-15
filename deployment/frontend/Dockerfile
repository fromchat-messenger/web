# 1. Build the frontend
FROM node:24 AS frontend

# 1.1. Install npm dependencies
WORKDIR /app
# Copy package.json and workspace package directory first (needed for workspace resolution)
COPY package.json .
COPY frontend/packages/ frontend/packages/
RUN --mount=type=cache,target=/root/.npm \
    npm install --ignore-scripts

# 1.2. Copy remaining frontend code and build
COPY frontend frontend
RUN npm run frontend:build


# 2. Build the static file server
FROM node:24 AS server

# 2.1. Install npm dependencies
WORKDIR /server
COPY deployment/frontend/package.json .
RUN --mount=type=cache,target=/root/.npm \
    npm install

# 2.2. Copy the code
COPY deployment/frontend/ .

# 2.3. Build
RUN npm run build


# 3. Put it all together
FROM node:24-slim

# 3.1. Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# 3.2. Non-root user
RUN useradd -u 1001 app && \
    mkdir -p /app && \
    chown -R app /app && \
    mkdir /server && \
    chown -R app /server
USER app

# 3.1. Frontend static files
WORKDIR /app
COPY --from=frontend --chown=app /app/frontend/build/normal/dist .

# 3.2. Static file server
WORKDIR /server
COPY --from=server --chown=app /server .

# 4. Final command
ENV STATIC_FILE_PATH=/app
ENTRYPOINT ["npm", "run", "start:prod"]