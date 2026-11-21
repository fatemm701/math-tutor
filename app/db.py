import sqlite3
from contextlib import contextmanager
from typing import Iterator

from app.config import settings

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    invite_code   TEXT UNIQUE,
    teacher_id    INTEGER REFERENCES users(id),
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    sid           TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      TEXT NOT NULL UNIQUE,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic          TEXT NOT NULL CHECK (topic IN ('simplify', 'equation', 'arithmetic')),
    level          INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),
    question       TEXT NOT NULL,
    answer         TEXT NOT NULL,
    student_answer TEXT NOT NULL,
    result         TEXT NOT NULL CHECK (result IN (
                       'correct', 'wrong', 'parentheses', 'unmerged',
                       'unisolated', 'unreduced', 'error'
                   )),
    used_hint      INTEGER NOT NULL DEFAULT 0,
    revealed       INTEGER NOT NULL DEFAULT 0,
    gave_up        INTEGER NOT NULL DEFAULT 0,
    is_fraction    INTEGER NOT NULL DEFAULT 0,
    is_decimal     INTEGER NOT NULL DEFAULT 0,
    ms             INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_time ON attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_filter    ON attempts(user_id, topic, level, result);
"""


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    db_path = settings.db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA_SQL)