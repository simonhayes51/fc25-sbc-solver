from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Dict
from urllib.parse import urljoin, urlparse

import aiohttp
from bs4 import BeautifulSoup

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
# coin text is optional here, kept for completeness
_COINS_RE = re.compile(r"([\d,]+)\s*(?:Image:\s*)?(?:FC\s*Coin|Coins?)", re.IGNORECASE)

# image URL pattern: .../player-item/25-<digits>.<anything>.webp
IMG_CARD_CODE_RE = re.compile(r"/player-item/25-(\d+)\.")  # capture digits after 25- up to the first dot

# ---------- Utils ----------
def normalize_version_id(code: str | int | None) -> str:
    """Digits only; strip leading zeros (so '000123' -> '123')."""
    s = re.sub(r"\D", "", str(code or ""))
    return s.lstrip("0") or s

def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()

async def _fetch(session: aiohttp.ClientSession, url: str) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
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

# ---------- SBC index & page parsing ----------
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

async def parse_sbc_page(session: aiohttp.ClientSession, slug: str) -> SbcEntry:
    """
    Parse the SBC set page and find each challenge block and its 'View Solution' link.
    """
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
        m = _COINS_RE.search(block_text or "")
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

    # Fallback: map any global /squad-builder/ anchor to nearest header
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

    # Prefer entries that have links when duplicates exist
    uniq: Dict[str, ChallengeBlock] = {}
    for c in challenges:
        k = c.name.lower().strip()
        if k not in uniq or (c.view_solution_url and not uniq[k].view_solution_url):
            uniq[k] = c
    challenges = list(uniq.values())

    return SbcEntry(slug=slug.strip("/"), title=title, challenges=challenges)

# ---------- Solution page -> players (IMAGE-ONLY) ----------
async def parse_solution_players(session: aiohttp.ClientSession, solution_url: str) -> List[Dict[str, str]]:
    """
    Extract players by scanning IMG URLs only:
      https://game-assets.fut.gg/.../player-item/25-<digits>.<hash>.webp
    Return list of dicts: { variant_code: <digits>, image_url: <src>, name: <alt if present> }
    """
    solution_url = urljoin(FUTGG_BASE, solution_url)
    html = await _fetch(session, solution_url)
    soup = BeautifulSoup(html, "html.parser")

    results: List[Dict[str, str]] = []
    seen_codes = set()

    # iterate visible <img> tags in DOM order
    for img in soup.find_all("img", src=True):
        src: str = img["src"]
        # Only consider player-item images (handle absolute or relative, cf transform doesn't matter)
        if "/player-item/" not in src:
            continue
        m = IMG_CARD_CODE_RE.search(src)
        if not m:
            continue
        code = normalize_version_id(m.group(1))
        if not code or code in seen_codes:
            continue
        seen_codes.add(code)
        alt = (img.get("alt") or "").strip()
        # normalize absolute URL if needed
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            # keep the same host as the solution page
            p = urlparse(solution_url)
            src = f"{p.scheme}://{p.netloc}{src}"
        results.append({"variant_code": code, "image_url": src, "name": alt})

        if len(results) >= 11:  # we only need first XI
            break

    return results
