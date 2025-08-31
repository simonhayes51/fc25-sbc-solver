from __future__ import annotations

import re
import aiohttp
from bs4 import BeautifulSoup
from dataclasses import dataclass
from typing import List, Optional, Dict
from urllib.parse import urljoin, urlparse

from app.services.browser import get_browser

FUTGG_BASE = "https://www.fut.gg"

# ---------- Models ----------
@dataclass
class ChallengeBlock:
    name: str
    coin_text: Optional[str]
    block_text: str
    view_solution_url: Optional[str]

@dataclass
class SbcEntry:
    slug: str
    title: str
    challenges: List[ChallengeBlock]

# ---------- Regex ----------
PLAYER_ANCHOR_RE = re.compile(r"/players/\d+(?:-[^/]+)?/25-(\d+)(?:/|$)")
COINS_RE = re.compile(r"([\d,]+)\s*(?:Image:\s*)?(?:FC\s*Coin|Coins?)", re.IGNORECASE)
IMAGE_SRC_CODE_RE = re.compile(r"/player-item/25-(\d+)")  # extract 25-<digits> from image path

# ---------- Utils ----------
def normalize_version_id(code: str | int | None) -> str:
    """Digits only; strip leading zeros so '25-0012345' -> '12345'."""
    s = re.sub(r"\D", "", str(code or ""))
    return s.lstrip("0") or s

def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()

async def _fetch(session: aiohttp.ClientSession, url: str) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://www.fut.gg/sbc/",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
    }
    timeout = aiohttp.ClientTimeout(total=35, connect=15, sock_connect=15, sock_read=30)
    async with session.get(url, headers=headers, timeout=timeout) as resp:
        resp.raise_for_status()
        return await resp.text()

def _is_view_solution_anchor(a) -> bool:
    if not a or not a.has_attr("href"):
        return False
    href = a["href"] or ""
    if "/squad-builder/" in href:
        return True
    txt = (a.get_text(" ", strip=True) or "").lower()
    if "view solution" in txt:
        return True
    for sp in a.find_all("span"):
        if "view solution" in (sp.get_text(" ", strip=True) or "").lower():
            return True
    return False

# ---------- Index ----------
async def list_sbc_player_slugs(session: aiohttp.ClientSession, index_url: str = f"{FUTGG_BASE}/sbc/") -> List[str]:
    html = await _fetch(session, index_url)
    soup = BeautifulSoup(html, "html.parser")
    slugs: List[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/sbc/players/" in href:
            try:
                slugs.append(href.split("/sbc/")[1].strip("/"))
            except Exception:
                pass
    # de-dup preserve order
    out, seen = [], set()
    for s in slugs:
        if s not in seen:
            out.append(s); seen.add(s)
    return out

# ---------- SBC page -> challenges ----------
async def parse_sbc_page(session: aiohttp.ClientSession, slug: str) -> SbcEntry:
    url = slug if slug.startswith("http") else f"{FUTGG_BASE}/sbc/{slug}"
    html = await _fetch(session, url)
    soup = BeautifulSoup(html, "html.parser")

    title_el = soup.find("h1")
    title = title_el.get_text(strip=True) if title_el else "SBC"

    headers = soup.find_all(["h2", "h3", "h4", "h5"])
    challenges: List[ChallengeBlock] = []

    for i, header in enumerate(headers):
        name = header.get_text(" ", strip=True)
        if name.strip().lower() == (title or "").strip().lower():
            continue

        next_header = headers[i + 1] if i + 1 < len(headers) else None

        view_solution_url: Optional[str] = None
        text_parts: List[str] = []

        for node in header.next_elements:
            if node is header:
                continue
            if next_header is not None and node is next_header:
                break

            if getattr(node, "name", None) in {"p", "li", "div", "span", "strong", "em", "ul", "ol"}:
                text_parts.append(node.get_text(" ", strip=True))

            if getattr(node, "name", None) == "a" and node.has_attr("href"):
                if _is_view_solution_anchor(node):
                    view_solution_url = urljoin(FUTGG_BASE, node["href"])

        block_text = _clean(" ".join(text_parts))
        m = COINS_RE.search(block_text or "")
        coin_text = m.group(1) if m else None

        if view_solution_url or "min." in (block_text or "").lower() or "rated squad" in (name or "").lower():
            challenges.append(
                ChallengeBlock(
                    name=name,
                    coin_text=coin_text,
                    block_text=block_text,
                    view_solution_url=view_solution_url,
                )
            )

    # Fallback: map any global view-solution button to nearest header
    if not any(c.view_solution_url for c in challenges):
        for a in soup.find_all("a", href=True):
            if _is_view_solution_anchor(a):
                prev_header = a.find_previous(["h2", "h3", "h4", "h5"])
                if prev_header:
                    target = prev_header.get_text(" ", strip=True)
                    for c in challenges:
                        if c.name == target and not c.view_solution_url:
                            c.view_solution_url = urljoin(FUTGG_BASE, a["href"])
                            break

    # prefer entries with links when duplicate names exist
    seen_by_name: Dict[str, ChallengeBlock] = {}
    for c in challenges:
        key = c.name.lower().strip()
        if key not in seen_by_name or (c.view_solution_url and not seen_by_name[key].view_solution_url):
            seen_by_name[key] = c
    challenges = list(seen_by_name.values())

    return SbcEntry(slug=slug.strip("/"), title=title, challenges=challenges)

# ---------- helpers to merge anchors + images ----------
def _merge_players(players: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """
    Dedup by variant_code (if present) else by normalized image_url, keep first occurrence.
    """
    out: List[Dict[str, str]] = []
    seen_codes, seen_imgs = set(), set()
    for p in players:
        code = p.get("variant_code") or ""
        img = p.get("image_url") or ""
        key_img = img.strip()
        if code:
            if code in seen_codes:
                # enrich existing (attach image if missing)
                for q in out:
                    if q.get("variant_code") == code and img and not q.get("image_url"):
                        q["image_url"] = img
                continue
            seen_codes.add(code)
        elif key_img:
            if key_img in seen_imgs:
                continue
            seen_imgs.add(key_img)
        out.append(p)
    return out

# ---------- Solution page -> players (fast HTTP) ----------
async def _parse_solution_players_http(session: aiohttp.ClientSession, solution_url: str) -> List[Dict[str, str]]:
    solution_url = urljoin(FUTGG_BASE, solution_url)
    html = await _fetch(session, solution_url)
    soup = BeautifulSoup(html, "html.parser")

    raw: List[Dict[str, str]] = []

    # 1) anchors
    for a in soup.find_all("a", href=True):
        path = urlparse(a["href"]).path
        m = PLAYER_ANCHOR_RE.search(path or "")
        if not m:
            continue
        code = normalize_version_id(m.group(1))
        name = a.get_text(" ", strip=True) or path
        raw.append({"name": name, "href": path, "variant_code": code})

    # 2) images (attach to same code if present; else add image-only)
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if "/player-item/" not in src:
            continue
        # absolute URL preferred
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            src = f"https://{urlparse(solution_url).netloc}{src}"
        code = None
        m = IMAGE_SRC_CODE_RE.search(urlparse(src).path)
        if m:
            code = normalize_version_id(m.group(1))
        name = (img.get("alt") or "").strip()
        entry = {"name": name, "href": "", "variant_code": code or "", "image_url": src}
        raw.append(entry)

    return _merge_players(raw)

# ---------- Solution page -> players (robust Playwright) ----------
async def _parse_solution_players_browser(solution_url: str) -> List[Dict[str, str]]:
    browser = await get_browser()
    context = await browser.new_context(ignore_https_errors=True, user_agent=(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ))
    page = await context.new_page()
    try:
        url = urljoin(FUTGG_BASE, solution_url)
        await page.goto(url, wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(600)

        raw: List[Dict[str, str]] = []

        # 1) Pull anchors from __NEXT_DATA__ JSON (even if not in DOM yet)
        data = await page.evaluate("""
        () => {
          const dump = JSON.stringify(window.__NEXT_DATA__ || {}, null, 0);
          const re = /\\/players\\/\\d+(?:-[^\\/]+)?\\/25-(\\d+)(?:\\/|$)/g;
          const seen = new Set();
          const out = [];
          let m;
          while ((m = re.exec(dump)) !== null) {
            const full = m[0];
            const code = m[1].replace(/^0+/, "");
            if (!seen.has(code)) {
              out.push({ href: full, variant_code: code });
              seen.add(code);
            }
          }
          return out;
        }
        """)
        for item in data or []:
            path = urlparse(item["href"]).path
            code = normalize_version_id(item["variant_code"])
            raw.append({"name": "", "href": path, "variant_code": code})

        # 2) DOM anchors (if available)
        anchors = await page.query_selector_all("a[href*='/players/'][href*='/25-']")
        for a in anchors:
            href = (await a.get_attribute("href")) or ""
            path = urlparse(href).path
            m = PLAYER_ANCHOR_RE.search(path or "")
            if not m:
                continue
            code = normalize_version_id(m.group(1))
            text = (await a.inner_text()) or path
            raw.append({"name": text.strip(), "href": path, "variant_code": code})

        # 3) Card images with /player-item/
        imgs = await page.query_selector_all("img[src*='/player-item/']")
        for img in imgs:
            src = (await img.get_attribute("src")) or ""
            alt = (await img.get_attribute("alt")) or ""
            code = None
            m = IMAGE_SRC_CODE_RE.search(urlparse(src).path)
            if m:
                code = normalize_version_id(m.group(1))
            raw.append({"name": alt.strip(), "href": "", "variant_code": code or "", "image_url": src})

        return _merge_players(raw)
    finally:
        await context.close()

# ---------- Public: solution page -> players ----------
async def parse_solution_players(session: aiohttp.ClientSession, solution_url: str) -> List[Dict[str, str]]:
    """
    Returns list of dicts with:
      - variant_code: digits after 25- (if present), '' otherwise
      - image_url: card image URL if present
    """
    players = await _parse_solution_players_http(session, solution_url)
    if players:
        return players
    return await _parse_solution_players_browser(solution_url)
