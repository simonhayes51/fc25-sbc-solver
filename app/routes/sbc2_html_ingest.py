# app/routes/sbc2_html_ingest.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, AnyUrl
from typing import Optional, List, Dict, Any
import httpx

from app.db import get_pg
from app.lib.sbc2_extract import (
    extract_player_ids_from_html,
    extract_player_image_urls,
    debug_summary,
)

router = APIRouter(prefix="/api/sbc2/html", tags=["sbc2-html"])

class SolutionHTMLIn(BaseModel):
    solution_url: Optional[AnyUrl] = None  # optional, for logging
    html: str

@router.post("/players")
async def players_from_html(payload: SolutionHTMLIn) -> Dict[str, Any]:
    """
    POST raw HTML from a FUT.GG solution page.
    Returns matched players (by fut_players.card_id) and any missing ids.
    """
    html = payload.html
    if not html or len(html) < 100:
        raise HTTPException(status_code=400, detail="HTML payload looks empty or truncated.")

    total_webp, ids_found_count = debug_summary(html)
    ids = extract_player_ids_from_html(html)
    img_urls = extract_player_image_urls(html)

    # Convert ids to ints for DB query
    ids_int: List[int] = []
    for s in ids:
        try:
            ids_int.append(int(s))
        except:
            pass

    pool = await get_pg()
    found_rows: List[Dict[str, Any]] = []
    async with pool.acquire() as conn:
        if ids_int:
            rows = await conn.fetch(
                """
                SELECT id, card_id, name, image_url
                FROM fut_players
                WHERE card_id = ANY($1::bigint[])
                """,
                ids_int,
            )
            found_rows = [dict(r) for r in rows]

        # Fallback by image_url if nothing matched by card_id
        if not found_rows and img_urls:
            rows2 = await conn.fetch(
                """
                SELECT id, card_id, name, image_url
                FROM fut_players
                WHERE image_url = ANY($1::text[])
                   OR EXISTS (
                        SELECT 1
                        FROM unnest($2::text[]) AS u(url)
                        WHERE image_url ILIKE '%' || u || '%'
                    )
                """,
                img_urls,
                [u.rsplit('/', 1)[-1] for u in img_urls],  # last path piece contains "25-<id>.<hash>.webp"
            )
            found_rows = [dict(r) for r in rows2]

    found_ids = {str(r["card_id"]) for r in found_rows if r.get("card_id") is not None}
    missing = [s for s in ids if s not in found_ids]

    return {
        "info": {
            "solution_url": str(payload.solution_url) if payload.solution_url else None,
            "html_len": len(html),
            "total_webp_in_html": total_webp,
            "extracted_ids_count": ids_found_count,
        },
        "all_extracted_card_ids": ids,        # strings
        "extracted_image_urls": img_urls,     # to help debug what we saw
        "found_count": len(found_rows),
        "found": found_rows,
        "missing_card_ids": missing,
    }

class SolutionURLIn(BaseModel):
    solution_url: AnyUrl

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

@router.post("/players-by-url")
async def players_from_url(payload: SolutionURLIn) -> Dict[str, Any]:
    """
    Optional: Fetch the page server-side then parse. If blocked by bot-protection,
    you'll get 0 results — in that case use /players with raw HTML instead.
    """
    url = str(payload.solution_url)
    try:
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": UA}) as client:
            r = await client.get(url)
            r.raise_for_status()
            html = r.text
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Fetch failed: {e}")

    return await players_from_html(SolutionHTMLIn(solution_url=url, html=html))
