from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.db import init_db
from app.routers import auth as auth_router
from app.routers import pages as pages_router
from app.routers import drill as drill_router
from app.routers import dashboard as dashboard_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="poly-drill", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.include_router(auth_router.router)
app.include_router(pages_router.router)
app.include_router(drill_router.router)
app.include_router(dashboard_router.router)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    return JSONResponse(
        {"success": False, "msg": str(exc.detail)},
        status_code=exc.status_code,
    )


@app.get("/api/health")
def health():
    return {"success": True, "data": {"status": "ok"}}