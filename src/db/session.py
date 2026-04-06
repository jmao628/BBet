"""
Database session factory — async (production) + sync (migrations/scripts).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from src.config import settings

# Async engine (for production ingestion / signal engine)
async_engine = create_async_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    async_engine,
    expire_on_commit=False,
    class_=AsyncSession,
)

# Sync engine (for Alembic migrations and scripts)
sync_engine = create_engine(
    settings.database_url_sync,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    echo=False,
)

SyncSessionLocal = sessionmaker(
    bind=sync_engine,
    autocommit=False,
    autoflush=False,
)


async def get_async_session() -> AsyncSession:
    """Async context manager for FastAPI / background tasks."""
    async with AsyncSessionLocal() as session:
        yield session


def get_sync_session() -> Session:
    """Sync session for scripts."""
    session = SyncSessionLocal()
    try:
        yield session
    finally:
        session.close()
