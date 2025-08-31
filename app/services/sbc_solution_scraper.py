from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
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

# ---------- Regex helpers ----------
_COINS_RE = re.compile(r"([\d,]+)\s*(?:Image:\s*)?(?:FC\s*Coin|Coins?)", re.IGNORECASE)
_PLAYER_LINK_RE = re.compile(r"^/players/\d+(?:-[^/]+)?/25-(\d+)(?:/|$)")
_SQUAD_BUILDER_PATH_RE = re.compile(r"/(?:\d+/)?squad-builder/([0-9a-fA-F-]{12,})/?")

# Fallback finders
_VARIANT_IN_TEXT_RE = re.compile(r"(?:^|[^0-9])25-(\d+)(?:/|[^0-9]|$)")
# Broad numeric finder (7–9 digits; covers typical EA/FUT version/card IDs)
_DIGIT_WINDOW_RE = re.compile(r"(?<!\d)(\d{7,9})(?!\d)")

# ---------- Tiny utils ----------
def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()

def normalize_version_id(code: str | int | None) -> str:
    """Digits-only version of any code; strips '25-' and anything non-numeric."""
    return re.sub(r"\D", "", str(code or ""))

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

async def fetch_solution_html(session: aiohttp.ClientSession, solution_url: str) -> str:
    """Public helper so routes can fetch the raw HTML for DB-verified fallbacks."""
    solution_url = urljoin(FUTGG_BASE, solution_url)
    return await _fetch(session, solution_url)

def _is_view_solution_anchor(a) -> bool:
    """True for anchors that act as 'View Solution' buttons (text or icon), or any /squad-builder/ href."""
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

# ---------- Public: index listing ----------
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

# ---------- Public: parse a single SBC page ----------
async def parse_sbc_page(session: aiohttp.ClientSession, slug: str) -> SbcEntry:
    """
    Extract challenge blocks and reliably find 'View Solution' anchors like:
      <a href="/25/squad-builder/<uuid>/"><span>View Solution</span>...</a>
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
        # Skip hero header equal to page title
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

    # Fallback: map global /squad-builder/ anchors to nearest header
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

    # Prefer versions that actually have links when names repeat
    seen_by_name: dict[str, ChallengeBlock] = {}
    for c in challenges:
        key = c.name.lower().strip()
        if key not in seen_by_name or (c.view_solution_url and not seen_by_name[key].view_solution_url):
            seen_by_name[key] = c
    challenges = list(seen_by_name.values())

    return SbcEntry(slug=slug.strip("/"), title=title, challenges=challenges)

# ---------- Solution page -> players ----------
def extract_variant_code_from_href(href_or_path: str) -> Optional[str]:
    path = urlparse(href_or_path).path
    m = _PLAYER_LINK_RE.search(path or "")
    return m.group(1) if m else None

def _walk(obj: Any):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)
    else:
        yield obj

def _dedup_and_normalize(players: List[Dict[str, str]]) -> List[Dict[str, str]]:
    out, seen = [], set()
    for p in players:
        v = normalize_version_id(p.get("variant_code"))
        if not v or v in seen:
            continue
        p["variant_code"] = v
        out.append(p); seen.add(v)
    return out

def _extract_players_from_soup(soup: BeautifulSoup) -> List[Dict[str, str]]:
    players: List[Dict[str, str]] = []
    for a in soup.find_all("a", href=True):
        path = urlparse(a["href"]).path  # works for relative or absolute
        if path.startswith("/players/") and "/25-" in path:
            name = a.get_text(" ", strip=True)
            code = extract_variant_code_from_href(path)
            if code:
                players.append({"name": name or path, "href": path, "variant_code": code, "position": ""})
    return _dedup_and_normalize(players)

def _extract_players_from_any_strings(data: Dict[str, Any]) -> List[Dict[str, str]]:
    found: List[Dict[str, str]] = []
    for node in _walk(data):
        if isinstance(node, str) and "/players/" in node and "/25-" in node:
            path = urlparse(node).path
            if path.startswith("/players/"):
                code = extract_variant_code_from_href(path)
                if code:
                    # name fallback from slug
                    segs = path.strip("/").split("/")
                    name_guess = segs[1].split("-")[1:] if len(segs) > 1 else []
                    name = " ".join(s.capitalize() for s in name_guess) or path
                    found.append({"name": name, "href": path, "variant_code": code, "position": ""})
    return _dedup_and_normalize(found)

def _extract_players_from_nextdata_json(data: Dict[str, Any]) -> List[Dict[str, str]]:
    # 1) Dict-shaped items with href/slug/link/url
    candidates: List[Dict[str, str]] = []
    for node in _walk(data):
        if isinstance(node, dict):
            href = node.get("href") or node.get("slug") or node.get("link") or node.get("url")
            name = node.get("name") or node.get("title") or node.get("playerName")
            if isinstance(href, str):
                path = urlparse(href).path
                if path.startswith("/players/") and "/25-" in path:
                    code = extract_variant_code_from_href(path)
                    if code:
                        candidates.append({
                            "name": (name or "").strip() or path,
                            "href": path,
                            "variant_code": code,
                            "position": ""
                        })
    # 2) Bare strings containing player paths
    candidates += _extract_players_from_any_strings(data)
    return _dedup_and_normalize(candidates)

async def _try_nextdata_endpoint(session: aiohttp.ClientSession, html: str, solution_url: str) -> List[Dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    script = soup.find("script", id="__NEXT_DATA__", type="application/json")
    if not script or not script.string:
        return []
    try:
        nextdata = json.loads(script.string)
    except Exception:
        return []

    # Scan the embedded JSON first
    prime = _extract_players_from_nextdata_json(nextdata)
    if prime:
        return prime

    # Try the _next/data/<buildId>/... JSON route
    build_id = nextdata.get("buildId")
    if not isinstance(build_id, str) or not build_id:
        return []

    m = _SQUAD_BUILDER_PATH_RE.search(urlparse(solution_url).path)
    if not m:
        return []
    uuid = m.group(1)

    json_url = urljoin(FUTGG_BASE, f"/_next/data/{build_id}/25/squad-builder/{uuid}.json")
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
                return []
            data = await resp.json()
        return _extract_players_from_nextdata_json(data)
    except Exception:
        return []

def extract_candidate_card_ids_from_text(text: str, max_ids: int = 200) -> List[str]:
    """
    Find plausible digits-only card/version IDs in raw HTML/JSON text:
      - 25-<digits>
      - any 7–9 digit numbers (later validated against DB)
    """
    candidates: List[str] = []
    # 25-<digits>
    for m in _VARIANT_IN_TEXT_RE.finditer(text or ""):
        candidates.append(normalize_version_id(m.group(1)))
    # Broad 7–9 digit sequences
    for m in _DIGIT_WINDOW_RE.finditer(text or ""):
        candidates.append(normalize_version_id(m.group(1)))
    # de-dup preserve order, cap
    out, seen = [], set()
    for c in candidates:
        if c and c not in seen:
            out.append(c); seen.add(c)
        if len(out) >= max_ids:
            break
    return out

async def parse_solution_players(session: aiohttp.ClientSession, solution_url: str) -> List[Dict[str, str]]:
    """
    Open a squad-builder solution page and return players with variant_code (digits only).
    Extraction order:
      1) Anchors in HTML
      2) __NEXT_DATA__ (and _next/data/<buildId>/...json)
      3) (routes will optionally use DB-verified raw-text fallback if still 0)
    """
    solution_url = urljoin(FUTGG_BASE, solution_url)
    html = await _fetch(session, solution_url)
    soup = BeautifulSoup(html, "html.parser")

    # A) in-HTML anchors
    players = _extract_players_from_soup(soup)
    if players:
        return players

    # B/C) Next.js fallbacks
    players = await _try_nextdata_endpoint(session, html, solution_url)
    if players:
        return players

    # D) No players here; routes may use fetch_solution_html + DB verification
    return []
