# app/lib/sbc2_extract.py
import re
from typing import List, Tuple

# Match player-item images like:
# https://game-assets.fut.gg/.../player-item/25-67356379.<hash>.webp
IMG_PLAYER_ITEM_ID = re.compile(r'/player-item/25-(\d+)[^"\']*?\.webp', re.I)

# Fallback: sometimes anchors show /players/.../25-<id>/
ANCHOR_PLAYER_ID = re.compile(r'/players/\d+-[^/]+/25-(\d+)/', re.I)

# Optional: collect all webp image URLs to help diagnose or fallback by image_url
IMG_PLAYER_ITEM_URL = re.compile(
    r'https?://[^"\']+/player-item/25-\d+[^"\']*?\.webp', re.I
)

def extract_player_ids_from_html(html: str) -> List[str]:
    """Primary extractor: 11 ids from /player-item/25-<digits>.webp; fallback to anchors."""
    if not html:
        return []
    seen = set()
    out: List[str] = []

    for m in IMG_PLAYER_ITEM_ID.finditer(html):
        pid = m.group(1)
        if pid not in seen:
            seen.add(pid)
            out.append(pid)
            if len(out) == 11:
                break

    if len(out) < 11:
        for m in ANCHOR_PLAYER_ID.finditer(html):
            pid = m.group(1)
            if pid not in seen:
                seen.add(pid)
                out.append(pid)
                if len(out) == 11:
                    break

    return out

def extract_player_image_urls(html: str) -> List[str]:
    """Return the full player-item image URLs (ends with .webp)."""
    if not html:
        return []
    seen = set()
    out: List[str] = []
    for m in IMG_PLAYER_ITEM_URL.finditer(html):
        url = m.group(0)
        if url not in seen:
            seen.add(url)
            out.append(url)
            if len(out) == 11:
                break
    return out

def count_webp_total(html: str) -> int:
    """Diagnostic: count *any* .webp occurrences (not only player-item)."""
    return len(re.findall(r'\.webp(?=["\'])', html, re.I))

def debug_summary(html: str) -> Tuple[int, int]:
    """Return (total .webp count, player-item ids found)."""
    total_webp = count_webp_total(html)
    ids = extract_player_ids_from_html(html)
    return total_webp, len(ids)
