# 1. Frontend production build
FROM node:24 AS builder

WORKDIR /app

# 1.1. Install dependencies
COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm install --ignore-scripts

# 1.2. Copy sources and configure
COPY . .

WORKDIR /app
ARG NODE_ENV=production
# Overridable at build time. Must be a real http(s) URL — never a compose ${...} stub.
ARG VITE_API_BASE_URL=https://api.fromchat.ru

# Fail the build if the arg is not a real URL (e.g. unexpanded Compose ${...}).
RUN if ! printf "%s" "${VITE_API_BASE_URL}" | grep -Eq '^https?://'; then \
      echo "ERROR: VITE_API_BASE_URL must be an http(s) URL, got: ${VITE_API_BASE_URL}" >&2; \
      exit 1; \
    fi && \
    export NODE_ENV=production VITE_API_BASE_URL && \
    npm run frontend:build


# 2. Production web static server
FROM joseluisq/static-web-server:latest AS production

# 2.1. Copy files to server root (/var/public -> /home/sws/public)
COPY --from=builder /app/build/normal/dist /var/public

# 2.2. Configure (defaults serve the image's built-in landing page instead of our app)
ENV SERVER_ROOT=/var/public
ENV SERVER_FALLBACK_PAGE=/var/public/index.html

EXPOSE 80