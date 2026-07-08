"""Shared browser launcher tuned to get past SeekingAlpha's bot detection.

SA blocks the vanilla Playwright Chromium (it advertises automation). Three
things together get a manual login and subsequent scraping through reliably:

1. Use the *real* Google Chrome install (``channel="chrome"``) instead of the
   bundled Chromium — its fingerprint matches a normal user.
2. Drop the automation flags (``--enable-automation``,
   ``AutomationControlled``) and hide ``navigator.webdriver``.
3. Use a *persistent* profile dir, so cookies / local storage survive between
   the login step and every later scrape — exactly like a normal browser that
   stays logged in.

If real Chrome isn't installed we fall back to bundled Chromium (may still be
blocked; installing Chrome is the fix).
"""

from __future__ import annotations

import logging

from newsagg.config import Settings

logger = logging.getLogger("newsagg.sa_browser")

_STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
window.chrome = window.chrome || { runtime: {} };
Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
"""


def profile_dir(settings: Settings) -> str:
    return str(settings.output_dir / "sa_profile")


async def launch_context(pw, settings: Settings, *, headless: bool):
    """Launch a persistent, low-detection browser context.

    Returns a Playwright ``BrowserContext`` (persistent contexts own their own
    browser process, so close the context, not a separate browser).
    """
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    common = dict(
        user_data_dir=profile_dir(settings),
        headless=headless,
        args=["--disable-blink-features=AutomationControlled", "--no-first-run"],
        ignore_default_args=["--enable-automation"],
        user_agent=settings.user_agent,
        viewport={"width": 1440, "height": 2200},
    )

    try:
        context = await pw.chromium.launch_persistent_context(channel="chrome", **common)
        logger.info("launched real Google Chrome (channel=chrome)")
    except Exception as exc:  # noqa: BLE001 — Chrome not installed / not found
        logger.warning("real Chrome unavailable (%s); falling back to bundled Chromium", exc)
        context = await pw.chromium.launch_persistent_context(**common)

    await context.add_init_script(_STEALTH_JS)
    return context
