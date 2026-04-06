#!/usr/bin/env python3
"""
Initialize the database — create all tables and TimescaleDB hypertables.
Run once on first setup: python scripts/init_db.py
"""

import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from src.db.models import Base
from src.db.session import sync_engine

import structlog

log = structlog.get_logger(__name__)


def init_db() -> None:
    log.info("creating_tables")
    Base.metadata.create_all(bind=sync_engine)
    log.info("tables_created")

    # Convert market_quotes to TimescaleDB hypertable (if TimescaleDB is installed)
    with sync_engine.connect() as conn:
        try:
            conn.execute(text("""
                SELECT create_hypertable(
                    'market_quotes',
                    'quote_time',
                    if_not_exists => TRUE
                );
            """))
            conn.commit()
            log.info("timescaledb_hypertable_created", table="market_quotes")
        except Exception as exc:
            log.warning(
                "timescaledb_not_available",
                error=str(exc),
                note="market_quotes will function as a regular table",
            )

        # Create indexes not managed by ORM
        indexes = [
            "CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date);",
            "CREATE INDEX IF NOT EXISTS idx_games_league ON games(league, season);",
            "CREATE INDEX IF NOT EXISTS idx_mc_game ON market_contracts(game_id);",
            "CREATE INDEX IF NOT EXISTS idx_mc_platform ON market_contracts(platform, status);",
            "CREATE INDEX IF NOT EXISTS idx_mq_contract ON market_quotes(contract_id, quote_time DESC);",
            "CREATE INDEX IF NOT EXISTS idx_obs_contract ON orderbook_snapshots(contract_id, snapshot_time DESC);",
            "CREATE INDEX IF NOT EXISTS idx_sl_game ON sportsbook_lines(game_id, sportsbook, odds_timestamp DESC);",
            "CREATE INDEX IF NOT EXISTS idx_signals_game ON signals(game_id, signal_time DESC);",
            "CREATE INDEX IF NOT EXISTS idx_pi_game ON player_injuries(game_id);",
        ]
        for idx_sql in indexes:
            try:
                conn.execute(text(idx_sql))
            except Exception as exc:
                log.warning("index_create_failed", sql=idx_sql, error=str(exc))
        conn.commit()
        log.info("indexes_created")

    log.info("database_init_complete")


if __name__ == "__main__":
    init_db()
