from slowapi import Limiter
from slowapi.util import get_remote_address
from app.config import settings

# Redis-backed limiter — rate limit state survives worker restarts and is
# shared across multiple backend replicas.
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.REDIS_URL,
)
