from __future__ import annotations
import re
import json
from dataclasses import dataclass
from typing import List, Dict, Optional, Any
import urllib.parse as _url

import aiohttp
from bs4 import BeautifulSoup

FUTGG_BASE = "https://www.fut.gg"

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

# tolerant coin matcher (handles "Image: FC Coin" artifacts)
_COINS_RE = re.compile(r"([\d,]+)\s*(?:Image:\s*)?(?:FC\s*Coin|Coins?)", re.IGNORECASE)
# variant code in href like /players/247515-john-barnes/25-67356379/
_PLAYER_LINK_RE = re.compile(r'^/players/\d+-[^/]+/25-(\d+)/')
# squad builder URL parts
_SQUAD_BUILDER_PATH_RE = re.compile(r'/(?:\d+/)?squad-builder/([0-9a-fA-F-]{12,})/?')

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
    seen, out = set(), []
    for s in slugs:
        if s not in seen:
            out.append(s); seen.add(s)
    return out

async def parse_sbc_page(session: aiohttp.ClientSession, slug: str) -> SbcEntry:
    """
    Open an SBC set page, extract challenge blocks and their View Solution links.
    Robust to icon-only links by matching '/squad-builder/' in href.
    """
    url = slug if slug.startswith("http") else f"{FUTGG_BASE}/sbc/{slug}"
    html = await _fetch(session, url)
    soup = BeautifulSoup(html, "html.parser")

    title_el = soup.find("h1")
    title = title_el.get_text(strip=True) if title_el else "SBC"

    challenges: List[ChallengeBlock] = []
    for header in soup.find_all(["h3", "h4", "h5"]):
        name = header.get_text(" ", strip=True)
        # collect siblings until next header
        nodes, nxt = [], header.find_next_sibling()
        while nxt and nxt.name not in ["h3", "h4", "h5"]:
            nodes.append(nxt)
            nxt = nxt.find_next_sibling()

        block_text = _clean(" ".join(n.get_text(" ", strip=True) for n in nodes if hasattr(n, "get_text")))
        m = _COINS_RE.search(block_text or "")
        coin_text = m.group(1) if m else None

        # robust solution-link detection (text OR href match)
        view_solution_url = None
        for n in nodes:
            for a in getattr(n, "find_all", lambda *a, **k: [])("a", href=True):
                txt = (a.get_text(strip=True) or "").lower()
                href = a["href"]
                if ("solution" in txt) or ("/squad-builder/" in href):
                    view_solution_url = href if href.startswith("http") else (FUTGG_BASE + href)
                    break
            if view_solution_url:
                break

        # keep likely challenge blocks even if no solution link (requirements-only)
        if view_solution_url or "min." in (block_text or "").lower() or "rated squad" in (name or "").lower():
            challenges.append(ChallengeBlock(
                name=name, coin_text=coin_text, block_text=block_text, view_solution_url=view_solution_url
            ))

    return SbcEntry(slug=slug.strip("/"), title=title, challenges=challenges)

def extract_variant_code_from_href(href: str) -> Optional[str]:
    m = _PLAYER_LINK_RE.search(href or "")
    return m.group(1) if m else None

def _walk(obj: Any):
    """Yield every node in a nested dict/list structure."""
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)
    else:
        yield obj

def _extract_players_from_soup(soup: BeautifulSoup) -> List[Dict[str, str]]:
    players: List[Dict[str, str]] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("/players/") and "/25-" in href:
            name = a.get_text(" ", strip=True)
            code = extract_variant_code_from_href(href)
            if code:
                pos = ""
                parent = a.find_parent()
                if parent:
                    cls = " ".join(parent.get("class", []))
                    m = re.search(r"\b(GK|LB|CB|RB|LWB|RWB|CDM|CM|CAM|LM|RM|LW|RW|ST|CF)\b", cls)
                    if m:
                        pos = m.group(1)
                players.append({"name": name, "href": href, "variant_code": code, "position": pos})
    # de-dup
    out, seen = [], set()
    for p in players:
        if p["variant_code"] not in seen:
            out.append(p); seen.add(p["variant_code"])
    return out

def _extract_players_from_nextdata_json(data: Dict[str, Any]) -> List[Dict[str, str]]:
    candidates: List[Dict[str, str]] = []
    for node in _walk(data):
        if isinstance(node, dict):
            href = node.get("href") or node.get("slug") or node.get("link")
            name = node.get("name") or node.get("title") or node.get("playerName")
            if isinstance(href, str) and href.startswith("/players/") and "/25-" in href:
                code = extract_variant_code_from_href(href)
                if code:
                    candidates.append({
                        "name": (name or "").strip() or href,
                        "href": href,
                        "variant_code": code,
                        "position": ""
                    })
    # de-dup preserve order
    out, seen = [], set()
    for p in candidates:
        if p["variant_code"] not in seen:
            out.append(p); seen.add(p["variant_code"])
    return out

async def _try_nextdata_endpoint(session: aiohttp.ClientSession, html: str, solution_url: str) -> List[Dict[str, str]]:
    """
    If buildId is present in __NEXT_DATA__, try the JSON data route:
      /_next/data/<buildId>/25/squad-builder/<uuid>.json
    """
    soup = BeautifulSoup(html, "html.parser")
    script = soup.find("script", id="__NEXT_DATA__", type="application/json")
    if not script or not script.string:
        return []
    try:
        nextdata = json.loads(script.string)
    except Exception:
        return []

    # Extract buildId
    build_id = nextdata.get("buildId")
    if not isinstance(build_id, str) or not build_id:
        # still try to scan the JSON we already have
        return _extract_players_from_nextdata_json(nextdata)

    # Need the UUID from the URL
    m = _SQUAD_BUILDER_PATH_RE.search(_url.urlparse(solution_url).path)
    if not m:
        return _extract_players_from_nextdata_json(nextdata)
    uuid = m.group(1)

    # Attempt the data JSON
    # FUT.GG tends to mount under /25/squad-builder/<uuid>
    path_guess = f"/_next/data/{build_id}/25/squad-builder/{uuid}.json"
    json_url = _url.urljoin(FUTGG_BASE, path_guess)

    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json,text/plain,*/*",
            "Referer": solution_url,
        }
        timeout = aiohttp.ClientTimeout(total=25)
        async with session.get(json_url, headers=headers, timeout=timeout) as resp:
            if resp.status != 200:
                # fall back to scanning __NEXT_DATA__ we already parsed
                return _extract_players_from_nextdata_json(nextdata)
            data = await resp.json()
        return _extract_players_from_nextdata_json(data)
    except Exception:
        return _extract_players_from_nextdata_json(nextdata)

async def parse_solution_players(session: aiohttp.ClientSession, solution_url: str) -> List[Dict[str, str]]:
    """
    Open a squad-builder solution page and return players with variant_code.
    1) Try anchors in HTML
    2) Fallback to __NEXT_DATA__
    3) Fallback to _next/data/<buildId>/...json
    """
    html = await _fetch(session, solution_url)
    soup = BeautifulSoup(html, "html.parser")

    # A) anchor path
    players = _extract_players_from_soup(soup)
    if players:
        return players

    # B/C) Next.js JSON fallbacks
    players = await _try_nextdata_endpoint(session, html, solution_url)
    return players or []
