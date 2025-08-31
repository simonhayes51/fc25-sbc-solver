# main.py
import os
import logging
import importlib
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ---- app setup ----
logger = logging.getLogger("uvicorn")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

app = FastAPI(
    title="FC25 SBC Solver API",
    version=os.getenv("APP_VERSION", "0.1.0"),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Allow browser calls (e.g., posting page HTML from FUT.GG tabs)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- include routers ----
def _include_router_safe(module_name: str, attr: str = "router"):
    try:
        mod = importlib.import_module(module_name)
        router = getattr(mod, attr)
        app.include_router(router)
        logger.info(f"Included router: {module_name}:{attr}")
    except Exception as e:
        logger.warning(f"Skipping router {module_name}:{attr} -> {e}")

# Require the new HTML ingest router (the one I gave you)
_include_router_safe("app.routes.sbc2_html_ingest")

# Optionally include your existing routers if present
_include_router_safe("app.routes.sbc2_db_render")   # render/pitch endpoints
_include_router_safe("app.routes.sbc2_ingest")      # ingest-all, init-schema, etc.
_include_router_safe("app.routes.sbc2_debug")       # any debug endpoints you created

# ---- health & root ----
@app.get("/")
def root():
    return {"status": "ok", "message": "SBC scraper API running"}

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/version")
def version():
    return {"version": app.version}

# ---- local dev entrypoint (Railway can still run `uvicorn main:app`) ----
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=bool(os.getenv("RELOAD", "0") == "1"),
    )