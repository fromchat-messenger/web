cd backend 
dotenv -e ../deployment/.env -- \
    ../.venv/bin/uvicorn main:app \
    --host 0.0.0.0 \
    --port 8300 \
    --reload \
    --reload-exclude './alembic' \
    --reload-exclude './alembic/*' \
    --reload-exclude './alembic/versions/*' \
    --access-log