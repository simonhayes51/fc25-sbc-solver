from __future__ import annotations

import re
import aiohttp
from bs4 import BeautifulSoup
from dataclasses import dataclass
from typing import List, Optional, Dict
from urllib.parse import urljoin, urlparse

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
# “View Solution” is detected by text and/or href containing /squad-builder/
_COINS_RE = re.compile(r"([\d,]+)\s*(?:Image:\s*)?(?:FC\s*Coin|Coins?)", re.IGNORECASE)
PLAYER_ANCHOR_RE = re.compile(r"/players/\d+(?:-[^/]+)?/25-(\d+)(?:/|$)")

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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
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

# ---------- Public: index ----------
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

# ---------- Public: SBC page -> challenges ----------
async def parse_sbc_page(session: aiohttp.ClientSession, slug: str) -> SbcEntry:
    """
    Find challenge sections and their 'View Solution' link (absolute URL).
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
            continue  # skip page hero header

        next_header = headers[i + 1] if i + 1 < len(headers) else None

        view_solution_url: Optional[str] = None
        text_parts: List[str] = []

        # walk this section until next header
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

    # fallback: map any global view-solution button to nearest header
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

    # prefer challenge entries that actually have links when names repeat
    seen_by_name: Dict[str, ChallengeBlock] = {}
    for c in challenges:
        key = c.name.lower().strip()
        if key not in seen_by_name or (c.view_solution_url and not seen_by_name[key].view_solution_url):
            seen_by_name[key] = c
    challenges = list(seen_by_name.values())

    return SbcEntry(slug=slug.strip("/"), title=title, challenges=challenges)

# ---------- Public: solution page -> players (anchor-only) ----------
async def parse_solution_players(session: aiohttp.ClientSession, solution_url: str) -> List[Dict[str, str]]:
    """
    ONLY extract from anchors like:
      /players/258980-alessia-russo/25-100922276/
    Returns list of {name, href, variant_code}, where variant_code is the
    digits after '25-' (leading zeros stripped).
    """
    solution_url = urljoin(FUTGG_BASE, solution_url)
    html = await _fetch(session, solution_url)
    soup = BeautifulSoup(html, "html.parser")

    raw: List[Dict[str, str]] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        path = urlparse(href).path  # works for absolute or relative URLs
        m = PLAYER_ANCHOR_RE.search(path or "")
        if not m:
            continue
        code = normalize_version_id(m.group(1))
        name = a.get_text(" ", strip=True) or path
        raw.append({"name": name, "href": path, "variant_code": code})

    # de-dup by variant_code, preserve order
    out, seen = [], set()
    for p in raw:
        vc = p["variant_code"]
        if vc and vc not in seen:
            out.append(p); seen.add(vc)
    return out
