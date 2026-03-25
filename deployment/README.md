# FromChat Compliance Architecture - Docker Deployment

This directory contains the Docker configuration for the 3-service compliance architecture.

## Architecture Overview

```
┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Clients   │────│   Main Service  │────│ Messaging       │
│             │    │  (Port 8300)    │    │ Service         │
│  Web/Apps   │    │                 │    │ (Port 8301)     │
│             │    │ • User auth     │    │ • Encryption    │
└─────────────┘    │ • WebSocket     │    │ • Compliance    │
                   │ • API proxy     │    │ • No ext access │
                   └─────────────────┘    └─────────────────┘
                            │                       │
                            │                       │
                            ▼                       ▼
                   ┌─────────────────┐    ┌─────────────────┐
                   │ File Storage    │    │   PostgreSQL    │
                   │ Service         │    │   Database      │
                   │ (Port 8302)     │    │ • Main schema   │
                   │ • Secure files  │    │ • Messaging     │
                   │ • No ext access │    │ • File schema   │
                   └─────────────────┘    └─────────────────┘
```

## Docker Build Optimization

- **Unified Dockerfile**: Single Dockerfile with multi-stage builds for all services
- **Shared Base**: Common Python dependencies cached in base stage
- **Zero System Dependencies**: No gcc, curl, or system packages - pure Python
- **Python Health Checks**: Built-in health monitoring using urllib
- **Aggressive Caching**: Pip cache and layer optimization
- **Security**: Non-root users, restricted permissions per service

## Security Features

- **Network Isolation**: Messaging and file storage services attach only to the internal `services` network (`internal: true`) — no path to the public internet. PostgreSQL is on `services` only (not on `public`), so other `public`-only containers cannot reach the DB over Docker DNS; the host still uses the published `127.0.0.1:5432` port map.
- **Inter-service rate limits**: The messaging and file_storage apps use SlowAPI with a high per-IP default (`5000/minute`) plus an exempt `/health` route; traffic is mostly from the main service. The main API keeps finer per-route limits.
- **Firewall note**: Isolation is enforced with Docker networks (not iptables inside containers). Optional **gVisor / runsc** remains a manual host-level step (see plan); it is not automated here.
- **Database Separation**: Each service has its own schema with minimal required permissions
- **Secure File Storage**: File storage uses restricted permissions and user isolation (stored files `chmod 600`, dirs `700`)
- **Ephemeral Keys**: Messaging service generates temporary keys (never persisted)

## Environment Variables Required

Create a `.env` file in this directory with the following variables:

```bash
# Database
POSTGRES_PASSWORD=your_secure_postgres_password
MAIN_DB_PASSWORD=separate_password_for_main_service
MESSAGING_DB_PASSWORD=separate_password_for_messaging
FILE_STORAGE_DB_PASSWORD=separate_password_for_file_storage

# Security
JWT_SECRET=your_jwt_secret_key
VAPID_PUBLIC_KEY=generated_vapid_public_key
VAPID_PRIVATE_KEY=generated_vapid_private_key

# Compliance (public key only - private key stays offline)
COMPLIANCE_PUBLIC_KEY=base64_encoded_public_key
```

The main backend **requires** Firebase for Android push (FCM). It is not generated into `.env`. The code loads `backend/firebase-cert.json` (path fixed relative to the backend tree); `docker-compose.yml` read-only-mounts that file into the container. Place your Firebase service account JSON at `backend/firebase-cert.json` before `docker compose up` (gitignored; excluded from the image build via the repo-root `.dockerignore`).

## Deployment Commands

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down

# Rebuild and restart
docker compose up -d --build
```

## Development Mode

For local development, set `SERVICE_MODE=development` to run all services in a single Python process instead of containers.

## Network Architecture

- **public**: External client access (main service, frontend, reverse proxy). Main is also on `services` so it can reach Postgres, messaging, and file_storage.
- **services**: Internal bridge (`internal: true`). Postgres, messaging, file_storage, and main. The **frontend** is on both `public` and `services` so the Node server can reach `main` and `file_storage` (`FILE_STORAGE_HOST`) for SSR/proxy paths without exposing those backends on `public` directly.
- Messaging and file_storage are **not** on `public` and cannot reach the internet.
- Inter-service traffic is HTTP with shared middleware (request size cap, rate limits on internal apps).

## Database Schema Separation

- `fromchat_main`: User data, authentication, profiles
- `fromchat_messaging`: Encrypted messages, keys, compliance data
- `fromchat_files`: File metadata, storage references

Each service has minimal required database permissions for security isolation.