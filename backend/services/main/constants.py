import os

# Database is always in backend/data/ relative to project root
DATABASE_URL = "sqlite:///" + os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "database.db")
JWT_ALGORITHM = "HS256"
# Token inactivity expiration - token expires if not used for this duration
TOKEN_INACTIVITY_EXPIRE_HOURS = 30 * 24  # 30 days of inactivity
# Maximum token lifetime (safety net) - tokens expire after this regardless of usage
MAX_TOKEN_LIFETIME_HOURS = 365 * 24  # 1 year maximum
OWNER_USERNAME = "denis0001-dev"
JWT_SECRET_KEY = os.getenv("JWT_SECRET")

if not JWT_SECRET_KEY:
    raise ValueError("JWT secret key empty")
JWT_ALGORITHM = "HS256"
# Token inactivity expiration - token expires if not used for this duration
TOKEN_INACTIVITY_EXPIRE_HOURS = 30 * 24  # 30 days of inactivity
# Maximum token lifetime (safety net) - tokens expire after this regardless of usage
MAX_TOKEN_LIFETIME_HOURS = 365 * 24  # 1 year maximum
OWNER_USERNAME = "denis0001-dev"
JWT_SECRET_KEY = os.getenv("JWT_SECRET")

if not JWT_SECRET_KEY:
    raise ValueError("JWT secret key empty")