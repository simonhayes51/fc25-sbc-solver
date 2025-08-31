# app/db.py
import os
import asyncpg
from typing import Optional

_pool: Optional[asyncpg.pool.Pool] = None

async def get_pg() -> asyncpg.pool.Pool:
    """Get (or create) a global asyncpg Pool using DATABASE_URL env var."""
    global _pool
    if _pool is None:
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL is not set")
        _pool = await asyncpg.create_pool(dsn, min_size=1, max_size=5)
    return _pool
