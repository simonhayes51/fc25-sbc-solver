# app/lib/sbc2_extract.py
import re
from typing import List

# Find FUT.GG player-item images and capture the number after 25-
# Example: /2025/player-item/25-67356379.f2c6...webp  -> 67356379
_RE_CODE = re.compile(r"/player-item/25-(\d+)\.", re.IGNORECASE)

def _dedupe_keep_order(items: List[str]) -> List[str]:
    seen = set()
    out = []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out

def extract_player_codes_from_html(html: str) -> List[str]:
    if not html:
        return []

    # Collect values of src=, data-src=, srcset=
    urls: List[str] = []

    # quoted attribute values
    for attr in ("src", "data-src", "srcset"):
        for m in re.finditer(rf'\b{attr}\s*=\s*("|\')([^"\']+)\1', html, re.IGNORECASE):
            val = m.group(2)
            if attr.lower() == "srcset":
                # srcset: "url1 1x, url2 2x"
                urls += [p.strip().split(" ")[0] for p in val.split(",") if p.strip()]
            else:
                urls.append(val)

    # Extract codes only from player-item .webp URLs
    codes: List[str] = []
    for u in urls:
        if "/player-item/" in u and u.lower().endswith(".webp"):
            m = _RE_CODE.search(u)
            if m:
                codes.append(m.group(1))

    return _dedupe_keep_order(codes)