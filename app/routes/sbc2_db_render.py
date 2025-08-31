from __future__ import annotations
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin
import os
import asyncpg
import aiohttp
from html import escape

from app.services.sbc_solution_scraper import (
    list_sbc_player_slugs, parse_sbc_page, parse_solution_players
)

# Price service: if you don't have it yet, this stub returns None
try:
    from app.services.prices import get_player_price  # (player_id, platform) -> int
except Exception:
    async def get_player_price(player_id: int, platform: str = "ps") -> Optional[int]:
        return None

router = APIRouter(prefix="/api/sbc2", tags=["SBC2"])

# ---------------- DB ----------------
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sbc_sets (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sbc_challenges (
  id SERIAL PRIMARY KEY,
  set_slug TEXT NOT NULL REFERENCES sbc_sets(slug) ON DELETE CASCADE,
  name TEXT NOT NULL,
  coin_text TEXT,
  block_text TEXT,
  view_solution_url TEXT,
  UNIQUE (set_slug, name)
);
CREATE TABLE IF NOT EXISTS sbc_challenge_players (
  challenge_id INTEGER NOT NULL REFERENCES sbc_challenges(id) ON DELETE CASCADE,
  variant_code TEXT NOT NULL,
  name TEXT,
  PRIMARY KEY (challenge_id, variant_code)
);
"""

async def get_pool() -> asyncpg.Pool:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL not set")
    return await asyncpg.create_pool(dsn, min_size=1, max_size=5)

def format_coins(n: Optional[int]) -> str:
    if n is None: return "—"
    return f"{n:,}c"

async def variant_code_to_player_id(con: asyncpg.Connection, code: str) -> Optional[int]:
    # 👇 change these columns to match your schema (variant/version id)
    row = await con.fetchrow(
        "SELECT id FROM fut_players WHERE variant_code = $1 OR version_id::text = $1 LIMIT 1",
        code
    )
    return row["id"] if row else None

DEFAULT_SLOTS = [
    (50, 92),  # GK
    (18, 76), (39, 74), (61, 74), (82, 76),  # LB, LCB, RCB, RB
    (30, 58), (50, 56), (70, 58),            # CM, CM, CM
    (25, 36), (50, 32), (75, 36),            # LW, ST, RW
]

def _render_pitch_html(title: str, subtitle: str, cards: List[Dict[str, Any]], total_txt: str) -> str:
    slots_html = "".join(
        f"<div class='slot' style='left:{c['x']}%;top:{c['y']}%;'>"
        f"<div class='card'><div class='price'>{escape(c['price_txt'])}</div>"
        f"<div class='name'>{escape(c['name'])}</div></div></div>"
        for c in cards
    )
    return f"""<!doctype html>
<html><head><meta charset='utf-8'><title>{escape(title)}</title>
<style>
body{{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0a1a0a;color:#fff;margin:0}}
.wrap{{max-width:1080px;margin:0 auto;padding:16px}}
h1{{font-size:20px;margin:0 0 8px}}
.subtitle{{opacity:.8;margin-bottom:16px}}
.pitch{{position:relative;width:100%;padding-top:62%;background:linear-gradient(#0f4d0f,#0b390b);border:2px solid #1f5f1f;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.3);margin-bottom:16px}}
.slot{{position:absolute;width:12%;transform:translate(-50%,-50%);text-align:center}}
.card{{background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:6px 6px 8px}}
.name{{font-size:12px;line-height:1.2;margin-top:4px}}
.price{{font-size:12px;opacity:.9}}
.total{{font-weight:700;font-size:16px;margin-top:8px}}
</style></head><body><div class='wrap'>
<h1>{escape(title)}</h1>
<div class='subtitle'>{escape(subtitle)}</div>
<div class='pitch'>
{slots_html}
</div>
<div class='total'>Total: {escape(total_txt)}</div>
</div></body></html>"""

# -------------- routes --------------

@router.post("/ingest/init-schema")
async def init_schema():
    pool = await get_pool()
    async with pool.acquire() as con:
        await con.execute(SCHEMA_SQL)
    await pool.close()
    return {"ok": True}

class IngestIn(BaseModel):
    limit: Optional[int] = None

@router.post("/ingest-all")
async def ingest_all(payload: IngestIn):
    try:
        async with aiohttp.ClientSession() as s:
            slugs = await list_sbc_player_slugs(s)
            if payload.limit:
                slugs = slugs[:payload.limit]

            pool = await get_pool()
            async with pool.acquire() as con:
                await con.execute(SCHEMA_SQL)
                for slug in slugs:
                    entry = await parse_sbc_page(s, slug)
                    # sets
                    await con.execute(
                        "INSERT INTO sbc_sets (slug,title) VALUES ($1,$2) "
                        "ON CONFLICT (slug) DO UPDATE SET title=$2",
                        entry.slug, entry.title
                    )
                    # challenges
                    for ch in entry.challenges:
                        cid = await con.fetchval(
                            """INSERT INTO sbc_challenges (set_slug,name,coin_text,block_text,view_solution_url)
                               VALUES ($1,$2,$3,$4,$5)
                               ON CONFLICT (set_slug,name) DO UPDATE 
                                 SET coin_text=$3, block_text=$4, view_solution_url=$5
                               RETURNING id""",
                            entry.slug, ch.name, ch.coin_text, ch.block_text, ch.view_solution_url
                        )
                        # solution players (if a link exists)
                        if ch.view_solution_url:
                            try:
                                players = await parse_solution_players(s, ch.view_solution_url)
                            except Exception as e:
                                players = [{"name": "ERROR", "variant_code": f"solution_fetch_failed: {e}"}]
                            for p in players:
                                await con.execute(
                                    """INSERT INTO sbc_challenge_players (challenge_id,variant_code,name)
                                       VALUES ($1,$2,$3)
                                       ON CONFLICT (challenge_id,variant_code) DO NOTHING""",
                                    cid, p.get("variant_code"), p.get("name")
                                )
        return {"ok": True, "ingested": len(slugs)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

# Convenient GET wrappers (clickable from browser)
@router.get("/ingest/init-schema")
async def init_schema_get():
    return await init_schema()

@router.get("/ingest-all")
async def ingest_all_get(limit: Optional[int] = None):
    return await ingest_all(IngestIn(limit=limit))

# Index + alias
@router.get("/index")
async def sbc_index(limit: Optional[int] = None):
    async with aiohttp.ClientSession() as s:
        slugs = await list_sbc_player_slugs(s)
    if limit:
        slugs = slugs[:limit]
    return {"count": len(slugs), "slugs": slugs}

@router.get("/index/")
async def sbc_index_alias(limit: Optional[int] = None):
    return await sbc_index(limit=limit)

# Challenges + alias
@router.get("/challenges/{path:path}")
async def sbc_challenges(path: str):
    async with aiohttp.ClientSession() as s:
        entry = await parse_sbc_page(s, path)
    return {
        "slug": entry.slug,
        "title": entry.title,
        "challenges": [
            {"name": c.name, "coin_text": c.coin_text, "block_text": c.block_text, "view_solution_url": c.view_solution_url}
            for c in entry.challenges
        ]
    }

@router.get("/challenges/{path:path}/")
async def sbc_challenges_alias(path: str):
    return await sbc_challenges(path)

# Render by SBC slug + challenge name (lenient matching across duplicate names)
@router.get("/render", response_class=HTMLResponse)
async def render_pitch(slug: str, challenge: str, platform: str = "ps"):
    async with aiohttp.ClientSession() as s:
        entry = await parse_sbc_page(s, slug)

        wanted = challenge.lower().strip()
        chall = next((c for c in entry.challenges
                      if c.name.lower().strip() == wanted and c.view_solution_url), None)
        if not chall:
            chall = next((c for c in entry.challenges
                          if c.name.lower().strip() == wanted), None)
        if chall and not chall.view_solution_url:
            twin = next((c for c in entry.challenges
                         if c.name.lower().strip() == wanted and c.view_solution_url), None)
            if twin:
                chall = twin
        if not chall or not chall.view_solution_url:
            any_with_link = next((c for c in entry.challenges if c.view_solution_url), None)
            if any_with_link:
                chall = any_with_link

        if not chall:
            raise HTTPException(404, f"Challenge '{challenge}' not found")
        if not chall.view_solution_url:
            raise HTTPException(404, "No View Solution URL on this challenge")

        players = await parse_solution_players(s, chall.view_solution_url)

    pool = await get_pool()
    total = 0
    cards: List[Dict[str, Any]] = []
    async with pool.acquire() as con:
        ordered = players[:11]
        for idx, p in enumerate(ordered):
            code = p.get("variant_code")
            pid = await variant_code_to_player_id(con, code) if code else None
            price = await get_player_price(pid, platform=platform) if pid is not None else None
            total += (price or 0)
            name = p.get("name") or f"#{code}"
            price_txt = format_coins(price)
            x, y = DEFAULT_SLOTS[idx] if idx < len(DEFAULT_SLOTS) else (50, 50)
            cards.append({"x": x, "y": y, "name": name, "price_txt": price_txt})

    total_txt = format_coins(total) if any(c["price_txt"] != "—" for c in cards) else "—"
    html = _render_pitch_html(f"{slug} — {challenge}", "", cards, total_txt)
    return HTMLResponse(content=html, status_code=200)

# Render directly from a squad-builder URL (accepts relative or absolute)
@router.get("/render-by-url", response_class=HTMLResponse)
async def render_by_url(solution_url: str = Query(...), platform: str = "ps"):
    solution_url = urljoin("https://www.fut.gg", solution_url)
    async with aiohttp.ClientSession() as s:
        players = await parse_solution_players(s, solution_url)

    pool = await get_pool()
    total = 0
    cards: List[Dict[str, Any]] = []
    async with pool.acquire() as con:
        ordered = players[:11]
        for idx, p in enumerate(ordered):
            code = p.get("variant_code")
            pid = await variant_code_to_player_id(con, code) if code else None
            price = await get_player_price(pid, platform=platform) if pid is not None else None
            total += (price or 0)
            name = p.get("name") or f"#{code}"
            price_txt = format_coins(price)
            x, y = DEFAULT_SLOTS[idx] if idx < len(DEFAULT_SLOTS) else (50, 50)
            cards.append({"x": x, "y": y, "name": name, "price_txt": price_txt})

    total_txt = format_coins(total) if any(c["price_txt"] != "—" for c in cards) else "—"
    html = _render_pitch_html("Solution Pitch", "", cards, total_txt)
    return HTMLResponse(content=html, status_code=200)

# Optional: schema peek
@router.get("/debug/schema")
async def debug_schema():
    pool = await get_pool()
    async with pool.acquire() as con:
        async def cols(table):
            rows = await con.fetch("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name=$1
                ORDER BY ordinal_position
            """, table)
            return [dict(r) for r in rows]
        return {
            "sbc_sets": await cols("sbc_sets"),
            "sbc_challenges": await cols("sbc_challenges"),
            "sbc_challenge_players": await cols("sbc_challenge_players"),
        }
