# app/routes/sbc2_html_ingest.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, HttpUrl
from typing import List, Optional
import asyncpg
import os

from app.lib.sbc2_extract import extract_player_codes_from_html

router = APIRouter(prefix="/api/sbc2/html", tags=["sbc2-html"])

_DB_POOL = None

async def get_pool() -> asyncpg.pool.Pool:
    global _DB_POOL
    if _DB_POOL is None:
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL not set")
        _DB_POOL = await asyncpg.create_pool(dsn, min_size=1, max_size=5)
    return _DB_POOL

class IngestCodesReq(BaseModel):
    solution_url: HttpUrl
    html: str

class PlayerRow(BaseModel):
    card_id: str
    name: Optional[str] = None
    price: Optional[int] = None

class IngestCodesResp(BaseModel):
    codes: List[str]           # the 11 codes found in the HTML (order preserved)
    found: List[PlayerRow]     # rows matched in fut_players
    matched: int               # count of found rows

@router.post("/ingest-codes", response_model=IngestCodesResp)
async def ingest_codes(req: IngestCodesReq):
    codes = extract_player_codes_from_html(req.html)

    if not codes:
        return IngestCodesResp(codes=[], found=[], matched=0)

    pool = await get_pool()

    # First try as text (works whether DB column is text or numeric, thanks to cast)
    rows = []
    try:
        rows = await pool.fetch(
            """
            SELECT card_id::text AS card_id, name, price
            FROM fut_players
            WHERE card_id::text = ANY($1::text[])
            """,
            codes,
        )
    except Exception as e:
        # Fallback: if column is strictly BIGINT and casting above fails (rare),
        # try numeric array. Non-numeric codes will be filtered.
        try:
            bigs = [int(c) for c in codes if c.isdigit()]
            rows = await pool.fetch(
                """
                SELECT card_id::text AS card_id, name, price
                FROM fut_players
                WHERE card_id = ANY($1::bigint[])
                """,
                bigs,
            )
        except Exception as ee:
            raise HTTPException(status_code=500, detail=f"DB lookup failed: {ee}")

    found = [
        PlayerRow(card_id=r["card_id"], name=r.get("name"), price=r.get("price"))
        for r in rows
    ]

    return IngestCodesResp(
        codes=codes,
        found=found,
        matched=len(found),
    )