#!/bin/bash
# Custom entrypoint for PostgreSQL that processes the init template

set -e

# If this is the first run (data directory is empty), process the template
if [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then
    echo "Processing PostgreSQL init template..."

    # Substitute environment variables in the SQL template
    envsubst < /docker-entrypoint-initdb.d/init-postgres.sql.template > /docker-entrypoint-initdb.d/init-postgres.sql

    echo "Template processing complete."
else
    echo "PostgreSQL data directory already exists, skipping template processing."
fi

# Execute the original PostgreSQL entrypoint
exec /usr/local/bin/docker-entrypoint.sh "$@"