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

- **Network Isolation**: Messaging and file storage services have NO external network access
- **Database Separation**: Each service has its own schema with minimal required permissions
- **Secure File Storage**: File storage uses restricted permissions and user isolation
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

The main backend **requires** Firebase for Android push (FCM). It is not generated into `.env`: `docker-compose.yml` sets `FIREBASE_CERT` and read-only-mounts `backend/firebase-cert.json` from the repo. Place your Firebase service account JSON at `backend/firebase-cert.json` before `docker compose up` (gitignored; excluded from the image build via the repo-root `.dockerignore`).

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

- **public**: External client access (main service, frontend, reverse proxy)
- **services**: Internal service communication only (database, messaging, file storage)
- Messaging and file storage services have NO external network access
- All inter-service communication is HTTP-based with proper authentication

## Database Schema Separation

- `fromchat_main`: User data, authentication, profiles
- `fromchat_messaging`: Encrypted messages, keys, compliance data
- `fromchat_files`: File metadata, storage references

Each service has minimal required database permissions for security isolation.