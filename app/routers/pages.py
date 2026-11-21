from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.auth import get_current_user
from app.config import settings

router = APIRouter(tags=["pages"])
templates = Jinja2Templates(directory="app/templates")


def _ctx(user: dict | None, active_nav: str, **extra) -> dict:
    return {
        "user": user,
        "active_nav": active_nav,
        "app_version": settings.app_version,
        **extra,
    }


@router.get("/", response_class=HTMLResponse)
def login_page(request: Request, user=Depends(get_current_user)):
    if user:
        return RedirectResponse(url="/simplify", status_code=302)
    return templates.TemplateResponse(request, "login.html", _ctx(None, "login"))


@router.get("/simplify", response_class=HTMLResponse)
def simplify_page(request: Request, user=Depends(get_current_user)):
    if not user:
        return RedirectResponse(url="/", status_code=302)
    return templates.TemplateResponse(
        request,
        "simplify.html",
        _ctx(user, "simplify", page_title="整式化简", topic="simplify"),
    )


@router.get("/equation", response_class=HTMLResponse)
def equation_page(request: Request, user=Depends(get_current_user)):
    if not user:
        return RedirectResponse(url="/", status_code=302)
    return templates.TemplateResponse(
        request, 
        "equation.html", 
        _ctx(user, "equation", page_title="一元一次方程", topic="equation"),
    )


@router.get("/arithmetic", response_class=HTMLResponse)
def arithmetic_page(request: Request, user=Depends(get_current_user)):
    if not user:
        return RedirectResponse(url="/", status_code=302)
    return templates.TemplateResponse(
        request, 
        "arithmetic.html", 
        _ctx(user, "arithmetic", page_title="口算训练", topic="arithmetic"),
    )


@router.get("/dashboard", response_class=HTMLResponse)
def dashboard_page(request: Request, user=Depends(get_current_user)):
    if not user:
        return RedirectResponse(url="/", status_code=302)
    title = "教师看板" if user["role"] == "teacher" else "我的看板"
    return templates.TemplateResponse(
        request, "placeholder.html", _ctx(user, "dashboard", page_title=title)
    )