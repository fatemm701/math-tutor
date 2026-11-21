import os
from pathlib import Path


class Settings:
    @property
    def db_path(self) -> Path:
        return Path(os.environ.get("DB_PATH", "data/poly_drill.db"))

    @property
    def teacher_invite(self) -> str:
        return os.environ.get("TEACHER_INVITE", "").strip()

    @property
    def app_version(self) -> str:
        return os.environ.get("APP_VERSION", "dev").strip()

    @property
    def session_ttl_seconds(self) -> int:
        days = int(os.environ.get("SESSION_TTL_DAYS", "30"))
        return days * 86400

    @property
    def cookie_secure(self) -> bool:
        return os.environ.get("COOKIE_SECURE", "0") == "1"


settings = Settings()