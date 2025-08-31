from fastapi import FastAPI
from app.routes import sbc2_db_render as sbc2

app = FastAPI(title="FUTGG SBC Scraper (Anchor-only)")

@app.get("/")
async def root():
    return {"status": "ok", "message": "SBC scraper API running"}

app.include_router(sbc2.router)
