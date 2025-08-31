from __future__ import annotations
import asyncio
from typing import Optional
from playwright.async_api import async_playwright, Browser

_browser: Optional[Browser] = None
_lock = asyncio.Lock()

async def get_browser() -> Browser:
    """
    Lazy-start a single shared headless Chromium instance.
    """
    global _browser
    async with _lock:
        if _browser is None:
            pw = await async_playwright().start()
            _browser = await pw.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )
            # keep a reference so we can stop() on shutdown if you add a lifespan hook
            setattr(_browser, "_pw", pw)
    return _browser

async def shutdown_browser() -> None:
    global _browser
    if _browser:
        pw = getattr(_browser, "_pw", None)
        await _browser.close()
        if pw:
            await pw.stop()
        _browser = None
