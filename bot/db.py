"""
Модуль персистентного хранения настроек чатов и расписания уведомлений в SQLite.
Сохраняет выбор группы/преподавателя для пользователей и групп, а также подписки на рассылку.
"""

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

# Определение пути к базе данных:
# 1) Из BOT_DB_PATH, если задано
# 2) В ../data/bot.db (если запускается из директории bot/)
# 3) В ./data/bot.db
_root_dir = Path(__file__).resolve().parent.parent
_default_data_dir = _root_dir / "data" if (_root_dir / "data").exists() else Path(__file__).resolve().parent / "data"
_configured_data_dir = Path(os.environ.get("DATA_DIR", _default_data_dir))

DB_PATH = Path(os.environ.get("BOT_DB_PATH", _configured_data_dir / "bot.db"))


def _get_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db(db_path: Path | str | None = None) -> None:
    """Инициализирует таблицы базы данных."""
    with _get_connection(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS chat_settings (
                chat_id INTEGER PRIMARY KEY,
                chat_type TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT '',
                entity_id TEXT NOT NULL DEFAULT '',
                entity_name TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notifications (
                chat_id INTEGER PRIMARY KEY,
                is_enabled INTEGER NOT NULL DEFAULT 1,
                notify_time TEXT NOT NULL DEFAULT '08:00',
                target_day TEXT NOT NULL DEFAULT 'today',
                skip_empty INTEGER NOT NULL DEFAULT 1,
                last_sent_date TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES chat_settings(chat_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_notify_schedule 
            ON notifications(is_enabled, notify_time);
            """
        )


def get_chat_pref(chat_id: int, db_path: Path | str | None = None) -> dict[str, Any] | None:
    """Возвращает настройки выбранного расписания для чата (пользователя или группы)."""
    with _get_connection(db_path) as conn:
        row = conn.execute(
            "SELECT chat_id, chat_type, title, kind, entity_id, entity_name FROM chat_settings WHERE chat_id = ?",
            (chat_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "chat_id": row["chat_id"],
            "chat_type": row["chat_type"],
            "title": row["title"],
            "kind": row["kind"],
            "id": row["entity_id"],
            "name": row["entity_name"],
        }


def set_chat_pref(
    chat_id: int,
    kind: str,
    entity_id: str,
    entity_name: str,
    chat_type: str = "",
    title: str = "",
    db_path: Path | str | None = None,
) -> None:
    """Сохраняет или обновляет выбранную группу/преподавателя для чата."""
    now_iso = datetime.now().isoformat()
    with _get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO chat_settings (chat_id, chat_type, title, kind, entity_id, entity_name, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                kind = excluded.kind,
                entity_id = excluded.entity_id,
                entity_name = excluded.entity_name,
                chat_type = CASE WHEN excluded.chat_type != '' THEN excluded.chat_type ELSE chat_settings.chat_type END,
                title = CASE WHEN excluded.title != '' THEN excluded.title ELSE chat_settings.title END,
                updated_at = excluded.updated_at
            """,
            (chat_id, chat_type, title, kind, entity_id, entity_name, now_iso),
        )


def get_notification(chat_id: int, db_path: Path | str | None = None) -> dict[str, Any] | None:
    """Возвращает параметры авто-рассылки для чата."""
    with _get_connection(db_path) as conn:
        row = conn.execute(
            """
            SELECT chat_id, is_enabled, notify_time, target_day, skip_empty, last_sent_date
            FROM notifications WHERE chat_id = ?
            """,
            (chat_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "chat_id": row["chat_id"],
            "is_enabled": bool(row["is_enabled"]),
            "notify_time": row["notify_time"],
            "target_day": row["target_day"],
            "skip_empty": bool(row["skip_empty"]),
            "last_sent_date": row["last_sent_date"],
        }


def set_notification(
    chat_id: int,
    is_enabled: bool = True,
    notify_time: str = "08:00",
    target_day: str = "today",
    skip_empty: bool = True,
    db_path: Path | str | None = None,
) -> None:
    """Сохраняет или обновляет подписку на авто-рассылку."""
    now_iso = datetime.now().isoformat()
    with _get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO notifications (chat_id, is_enabled, notify_time, target_day, skip_empty, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                is_enabled = excluded.is_enabled,
                notify_time = excluded.notify_time,
                target_day = excluded.target_day,
                skip_empty = excluded.skip_empty,
                updated_at = excluded.updated_at
            """,
            (chat_id, 1 if is_enabled else 0, notify_time, target_day, 1 if skip_empty else 0, now_iso),
        )


def toggle_notification(
    chat_id: int,
    enable: bool | None = None,
    db_path: Path | str | None = None,
) -> bool:
    """Включает или выключает уведомления. Если enable=None, переключает текущее состояние."""
    current = get_notification(chat_id, db_path=db_path)
    now_iso = datetime.now().isoformat()
    new_state = (not current["is_enabled"]) if (current and enable is None) else (bool(enable) if enable is not None else True)
    
    with _get_connection(db_path) as conn:
        if current:
            conn.execute(
                "UPDATE notifications SET is_enabled = ?, updated_at = ? WHERE chat_id = ?",
                (1 if new_state else 0, now_iso, chat_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO notifications (chat_id, is_enabled, notify_time, target_day, skip_empty, updated_at)
                VALUES (?, ?, '08:00', 'today', 1, ?)
                """,
                (chat_id, 1 if new_state else 0, now_iso),
            )
    return new_state


def update_notification_field(
    chat_id: int,
    field: str,
    value: Any,
    db_path: Path | str | None = None,
) -> None:
    """Обновляет отдельное поле в настройках уведомлений."""
    allowed = {"notify_time", "target_day", "skip_empty", "is_enabled"}
    if field not in allowed:
        raise ValueError(f"Недопустимое поле: {field}")
    now_iso = datetime.now().isoformat()
    with _get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO notifications (chat_id, is_enabled, notify_time, target_day, skip_empty, updated_at)
            VALUES (?, 1, '08:00', 'today', 1, ?)
            """,
            (chat_id, now_iso),
        )
        if field in ("is_enabled", "skip_empty"):
            val_to_save = 1 if value else 0
        else:
            val_to_save = str(value)
        conn.execute(
            f"UPDATE notifications SET {field} = ?, updated_at = ? WHERE chat_id = ?",
            (val_to_save, now_iso, chat_id),
        )


def disable_notification(chat_id: int, db_path: Path | str | None = None) -> None:
    """Отключает уведомления для чата (например, если бот заблокирован)."""
    now_iso = datetime.now().isoformat()
    with _get_connection(db_path) as conn:
        conn.execute(
            "UPDATE notifications SET is_enabled = 0, updated_at = ? WHERE chat_id = ?",
            (now_iso, chat_id),
        )


def mark_notification_sent(chat_id: int, date_str: str, db_path: Path | str | None = None) -> None:
    """Фиксирует дату последней успешной отправки уведомления."""
    with _get_connection(db_path) as conn:
        conn.execute(
            "UPDATE notifications SET last_sent_date = ? WHERE chat_id = ?",
            (date_str, chat_id),
        )


def get_due_notifications(
    current_time_str: str,
    current_date_str: str,
    db_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """
    Возвращает список чатов, для которых наступило время отправки расписания.
    Исключает чаты, где сегодня уже отправлялось уведомление.
    """
    with _get_connection(db_path) as conn:
        rows = conn.execute(
            """
            SELECT 
                n.chat_id,
                n.notify_time,
                n.target_day,
                n.skip_empty,
                s.kind,
                s.entity_id,
                s.entity_name,
                s.chat_type,
                s.title
            FROM notifications n
            JOIN chat_settings s ON n.chat_id = s.chat_id
            WHERE n.is_enabled = 1
              AND n.notify_time = ?
              AND (n.last_sent_date IS NULL OR n.last_sent_date != ?)
            """,
            (current_time_str, current_date_str),
        ).fetchall()

        return [
            {
                "chat_id": r["chat_id"],
                "notify_time": r["notify_time"],
                "target_day": r["target_day"],
                "skip_empty": bool(r["skip_empty"]),
                "kind": r["kind"],
                "entity_id": r["entity_id"],
                "entity_name": r["entity_name"],
                "chat_type": r["chat_type"],
                "title": r["title"],
            }
            for r in rows
        ]


def register_chat(
    chat_id: int,
    chat_type: str = "",
    title: str = "",
    db_path: Path | str | None = None,
) -> None:
    """Регистрирует чат в базе данных, если он ещё не был зарегистрирован."""
    now_iso = datetime.now().isoformat()
    with _get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO chat_settings (chat_id, chat_type, title, kind, entity_id, entity_name, updated_at)
            VALUES (?, ?, ?, '', '', '', ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                chat_type = CASE WHEN excluded.chat_type != '' THEN excluded.chat_type ELSE chat_settings.chat_type END,
                title = CASE WHEN excluded.title != '' THEN excluded.title ELSE chat_settings.title END
            """,
            (chat_id, chat_type, title, now_iso),
        )


def get_all_chats(db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """Возвращает список всех когда-либо подключившихся чатов."""
    with _get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT chat_id, chat_type, title, entity_name FROM chat_settings ORDER BY updated_at DESC"
        ).fetchall()
        return [
            {
                "chat_id": r["chat_id"],
                "chat_type": r["chat_type"],
                "title": r["title"],
                "entity_name": r["entity_name"],
            }
            for r in rows
        ]


def get_stats(db_path: Path | str | None = None) -> dict[str, int]:
    """Возвращает общую статистику настроек и подписок."""
    with _get_connection(db_path) as conn:
        total_chats = conn.execute("SELECT COUNT(*) FROM chat_settings").fetchone()[0]
        configured_chats = conn.execute(
            "SELECT COUNT(*) FROM chat_settings WHERE entity_id != ''"
        ).fetchone()[0]
        group_chats = conn.execute(
            "SELECT COUNT(*) FROM chat_settings WHERE chat_type IN ('group', 'supergroup')"
        ).fetchone()[0]
        active_notifs = conn.execute(
            "SELECT COUNT(*) FROM notifications WHERE is_enabled = 1"
        ).fetchone()[0]
        return {
            "total_chats": total_chats,
            "configured_chats": configured_chats,
            "group_chats": group_chats,
            "private_chats": total_chats - group_chats,
            "active_notifications": active_notifs,
        }
