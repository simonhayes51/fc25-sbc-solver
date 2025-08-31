
from __future__ import annotations
import re
from dataclasses import dataclass
from typing import List, Dict, Optional
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

async def _fetch(session: aiohttp.ClientSession, url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SBCScraper/1.0)",
        "Accept": "text/html,application/xhtml+xml",
    }
    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=25)) as resp:
        resp.raise_for_status()
        return await resp.text()

async def list_sbc_player_slugs(session: aiohttp.ClientSession, index_url: str = f"{FUTGG_BASE}/sbc/") -> List[str]:
    html = await _fetch(session, index_url)
    soup = BeautifulSoup(html, "html.parser")
    slugs = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/sbc/players/" in href:
            slugs.append(href.split("/sbc/")[1].strip("/"))
    seen=set(); out=[]
    for s in slugs:
        if s not in seen:
            out.append(s); seen.add(s)
    return out

_COINS_RE = re.compile(r"([\d,]+\s*(?:FC\s*Coin|Coins?))", re.IGNORECASE)
def _clean(s:str)->str:
    return re.sub(r"\s+", " ", s).strip()

async def parse_sbc_page(session: aiohttp.ClientSession, slug: str) -> SbcEntry:
    url = slug if slug.startswith("http") else f"{FUTGG_BASE}/sbc/{slug}"
    html = await _fetch(session, url)
    soup = BeautifulSoup(html, "html.parser")
    title_el = soup.find("h1")
    title = title_el.get_text(strip=True) if title_el else "SBC"
    challenges: List[ChallengeBlock] = []
    for header in soup.find_all(["h3","h4","h5"]):
        name = header.get_text(' ', strip=True)
        nodes=[]; nxt = header.find_next_sibling()
        while nxt and nxt.name not in ['h3','h4','h5']:
            nodes.append(nxt); nxt = nxt.find_next_sibling()
        block_text = _clean(' '.join(n.get_text(' ', strip=True) for n in nodes if hasattr(n,'get_text')))
        m = _COINS_RE.search(block_text or "")
        coin_text = m.group(1) if m else None
        view_solution_url = None
        for n in nodes:
            for a in getattr(n,'find_all',lambda *_:[])('a', href=True):
                if 'view solution' in a.get_text(strip=True).lower():
                    href = a['href']
                    view_solution_url = href if href.startswith('http') else ('https://www.fut.gg'+href)
                    break
            if view_solution_url: break
        if view_solution_url or 'min.' in (block_text or '').lower() or 'rated squad' in (name or '').lower():
            challenges.append(ChallengeBlock(name=name, coin_text=coin_text, block_text=block_text, view_solution_url=view_solution_url))
    return SbcEntry(slug=slug.strip('/'), title=title, challenges=challenges)

_PLAYER_LINK_RE = re.compile(r'^/players/\d+-[^/]+/25-(\d+)/')
def extract_variant_code_from_href(href: str) -> Optional[str]:
    m = _PLAYER_LINK_RE.search(href)
    return m.group(1) if m else None

async def parse_solution_players(session: aiohttp.ClientSession, solution_url: str) -> List[Dict[str, str]]:
    html = await _fetch(session, solution_url)
    soup = BeautifulSoup(html, "html.parser")
    players = []
    for a in soup.find_all('a', href=True):
        href = a['href']
        if href.startswith('/players/') and '/25-' in href:
            name = a.get_text(' ', strip=True)
            code = extract_variant_code_from_href(href)
            if code:
                # try position from parent class
                pos = ''
                parent = a.find_parent()
                if parent:
                    cls = ' '.join(parent.get('class', []))
                    import re as _re
                    m = _re.search(r'\b(GK|LB|CB|RB|LWB|RWB|CDM|CM|CAM|LM|RM|LW|RW|ST|CF)\b', cls)
                    if m: pos = m.group(1)
                players.append({'name': name, 'href': href, 'variant_code': code, 'position': pos})
    # de-dup
    out, seen = [], set()
    for p in players:
        if p['variant_code'] not in seen:
            out.append(p); seen.add(p['variant_code'])
    return out
