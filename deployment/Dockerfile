# ============================================================================
# COMPLIANCE ARCHITECTURE - Unified Dockerfile
# ============================================================================
# Base stage with common dependencies for all services

FROM python:3.12-slim AS base

# Create common directories
RUN mkdir -p /app && \
    useradd -u 1000 -m app && \
    useradd -u 1001 -m messaging && \
    useradd -u 1002 -m -s /bin/false filestorage

# Set working directory
WORKDIR /app

# Copy health check script
COPY --chown=app:app deployment/healthcheck.py /usr/local/bin/healthcheck.py
RUN chmod +x /usr/local/bin/healthcheck.py

# Copy and install Python dependencies with pip cache
COPY --chown=app:app backend/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# ============================================================================
# MAIN SERVICE - User-facing operations
# ============================================================================
FROM base AS main

# Copy main service code
COPY --chown=app:app backend/services/main/ ./services/main/
COPY --chown=app:app backend/services/shared/ ./services/shared/
COPY --chown=app:app backend/alembic/ ./alembic/
COPY --chown=app:app backend/alembic.ini ./

# Create data directories for main service
RUN mkdir -p /app/data /app/logs /app/alembic/versions && \
    chown -R app:app /app/data /app/logs /app/alembic

# Switch to non-root user
USER app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python3 /usr/local/bin/healthcheck.py

# Expose port
EXPOSE ${PORT:-8300}

# Run main service
CMD ["python", "-m", "services.main.main"]

# ============================================================================
# MESSAGING SERVICE - Secure cryptographic processing
# ============================================================================
FROM base AS messaging

# Copy messaging service code
COPY --chown=messaging:messaging backend/services/messaging/ ./services/messaging/
COPY --chown=messaging:messaging backend/services/shared/ ./services/shared/

# Create directories with restricted permissions
RUN mkdir -p /app/logs && \
    chown -R messaging:messaging /app && \
    chmod 700 /app

# Switch to non-root user
USER messaging

# Health check - only accessible internally
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python3 /usr/local/bin/healthcheck.py

# Expose port (internal only)
EXPOSE ${PORT:-8301}

# Run messaging service
CMD ["python", "-m", "services.messaging.main"]

# ============================================================================
# FILE STORAGE SERVICE - Secure file storage with execution prevention
# ============================================================================
FROM base AS file_storage

# Copy file storage service code
COPY --chown=filestorage:filestorage backend/services/file_storage/ ./services/file_storage/
COPY --chown=filestorage:filestorage backend/services/shared/ ./services/shared/
COPY --chown=filestorage:filestorage backend/services/main/db.py ./services/main/
COPY --chown=filestorage:filestorage backend/services/main/dependencies.py ./services/main/
COPY --chown=filestorage:filestorage backend/services/main/models.py ./services/main/
COPY --chown=filestorage:filestorage backend/services/main/constants.py ./services/main/
COPY --chown=filestorage:filestorage backend/services/main/utils.py ./services/main/

# Create secure file storage directories
RUN mkdir -p /app/files /app/logs && \
    chown -R filestorage:filestorage /app && \
    chmod 700 /app

# Switch to non-root user
USER filestorage

# Health check - only accessible internally
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python3 /usr/local/bin/healthcheck.py

# Expose port (internal only)
EXPOSE ${PORT:-8302}

# Run file storage service with permission fix
CMD ["sh", "-c", "chown -R filestorage:filestorage /app/files /app/logs 2>/dev/null || true && exec python -m services.file_storage.main"]