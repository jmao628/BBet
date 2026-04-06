"""
Alert system — Slack and email notifications for actionable signals and anomalies.
"""

from __future__ import annotations

import json
import smtplib
from email.mime.text import MIMEText
from typing import Any

import httpx
import structlog

from src.config import settings

log = structlog.get_logger(__name__)


class SlackAlerter:
    """Send structured alerts to Slack via webhook."""

    def __init__(self, webhook_url: str | None = None) -> None:
        self._webhook = webhook_url or settings.slack_webhook_url

    async def send(self, message: str, blocks: list | None = None) -> bool:
        if not self._webhook:
            log.debug("slack_not_configured")
            return False
        payload: dict[str, Any] = {"text": message}
        if blocks:
            payload["blocks"] = blocks
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(self._webhook, json=payload, timeout=10)
                resp.raise_for_status()
            return True
        except Exception as exc:
            log.warning("slack_send_failed", error=str(exc))
            return False

    async def send_signal_alert(self, signal: Any) -> bool:
        """Format and send a trading signal alert."""
        if not signal.is_actionable:
            return False

        emoji = ":large_green_circle:" if signal.confidence_tier == "HIGH" else ":large_yellow_circle:"
        direction_emoji = ":arrow_up:" if signal.direction == "YES" else ":arrow_down:"

        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{emoji} BPMDE Signal — {signal.home_team} vs {signal.away_team}",
                },
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Platform:* {signal.platform}"},
                    {"type": "mrkdwn", "text": f"*Market Type:* {signal.market_type}"},
                    {"type": "mrkdwn", "text": f"*Direction:* {direction_emoji} {signal.direction}"},
                    {"type": "mrkdwn", "text": f"*Edge:* {signal.edge:.2%}"},
                    {"type": "mrkdwn", "text": f"*EV:* {signal.expected_value:.2%}"},
                    {"type": "mrkdwn", "text": f"*Fair Prob:* {signal.ensemble_fair_prob:.2%}"},
                    {"type": "mrkdwn", "text": f"*Market Mid:* {signal.yes_mid:.2%}"},
                    {"type": "mrkdwn", "text": f"*Confidence:* {signal.confidence_tier} ({signal.confidence_score:.2f})"},
                    {"type": "mrkdwn", "text": f"*Suggested Size:* ${signal.suggested_size_usd:.0f}"},
                    {"type": "mrkdwn", "text": f"*TTG:* {signal.time_to_game_hours:.1f}h"},
                ],
            },
        ]

        if signal.key_drivers:
            drivers_text = "\n".join(
                f"• {d['factor']}: {d['impact']:+.3f}" for d in signal.key_drivers
            )
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*Key Drivers:*\n{drivers_text}"},
            })

        if signal.risk_flags:
            flags_text = "\n".join(
                f"• [{f['severity']}] {f['flag']}: {f['note']}" for f in signal.risk_flags
            )
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*Risk Flags:*\n{flags_text}"},
            })

        summary = (
            f"BPMDE [{signal.platform}] {signal.home_team} vs {signal.away_team} | "
            f"{signal.direction} | Edge={signal.edge:.2%} | ${signal.suggested_size_usd:.0f}"
        )

        return await self.send(summary, blocks=blocks)

    async def send_anomaly_alert(self, anomaly_type: str, details: dict) -> bool:
        """Send alert for data anomalies or risk breaches."""
        message = f":warning: BPMDE Anomaly — {anomaly_type}: {json.dumps(details, default=str)}"
        return await self.send(message)


class DataQualityChecker:
    """Periodic health checks on data freshness."""

    STALE_THRESHOLDS = {
        "market_quotes": 5,       # minutes
        "sportsbook_lines": 20,
        "player_injuries": 240,   # 4 hours
        "team_features": 1440,    # 1 day
    }

    def __init__(self, db_session: Any, alerter: SlackAlerter) -> None:
        self.db = db_session
        self.alerter = alerter

    async def run_all_checks(self) -> dict[str, Any]:
        results: dict[str, Any] = {}
        # In production, query max(updated_at) from each table
        # and compare to now() - threshold
        # Simplified here — full implementation in scripts/health_check.py
        log.info("data_quality_check_run")
        return results
