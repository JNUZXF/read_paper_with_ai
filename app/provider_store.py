import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.schemas import ProviderConfigCreate, ProviderConfigOut, ProviderConfigUpdate

DB_PATH = Path("data/providers.db")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask_key(api_key: str) -> str:
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:4]}...{api_key[-4:]}"


def init_store() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS provider_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                api_key TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def _row_to_out(row: sqlite3.Row) -> ProviderConfigOut:
    return ProviderConfigOut(
        id=row["id"],
        name=row["name"],
        api_key_masked=_mask_key(row["api_key"]),
        base_url=row["base_url"],
        model=row["model"],
        is_default=bool(row["is_default"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_providers() -> list[ProviderConfigOut]:
    init_store()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM provider_configs ORDER BY is_default DESC, updated_at DESC"
        ).fetchall()
        return [_row_to_out(r) for r in rows]


def create_provider(payload: ProviderConfigCreate) -> ProviderConfigOut:
    init_store()
    now = _now_iso()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        if payload.is_default:
            conn.execute("UPDATE provider_configs SET is_default = 0")
        cur = conn.execute(
            """
            INSERT INTO provider_configs(name, api_key, base_url, model, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name,
                payload.api_key,
                str(payload.base_url),
                payload.model,
                1 if payload.is_default else 0,
                now,
                now,
            ),
        )
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
        conn.commit()
    return _row_to_out(row)


def update_provider(provider_id: int, payload: ProviderConfigUpdate) -> ProviderConfigOut | None:
    init_store()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ?",
            (provider_id,),
        ).fetchone()
        if not row:
            return None

        name = payload.name if payload.name is not None else row["name"]
        api_key = payload.api_key if payload.api_key is not None else row["api_key"]
        base_url = str(payload.base_url) if payload.base_url is not None else row["base_url"]
        model = payload.model if payload.model is not None else row["model"]
        is_default = payload.is_default if payload.is_default is not None else bool(row["is_default"])
        if is_default:
            conn.execute("UPDATE provider_configs SET is_default = 0")

        conn.execute(
            """
            UPDATE provider_configs
            SET name = ?, api_key = ?, base_url = ?, model = ?, is_default = ?, updated_at = ?
            WHERE id = ?
            """,
            (name, api_key, base_url, model, 1 if is_default else 0, _now_iso(), provider_id),
        )
        updated = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ?",
            (provider_id,),
        ).fetchone()
        conn.commit()
    return _row_to_out(updated)


def delete_provider(provider_id: int) -> bool:
    init_store()
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute("DELETE FROM provider_configs WHERE id = ?", (provider_id,))
        conn.commit()
        return cur.rowcount > 0


def get_provider_secret(provider_id: int) -> dict[str, str] | None:
    init_store()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT api_key, base_url, model FROM provider_configs WHERE id = ?",
            (provider_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "api_key": row["api_key"],
            "base_url": row["base_url"],
            "model": row["model"],
        }
