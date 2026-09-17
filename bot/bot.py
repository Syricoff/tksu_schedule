"""
Telegram-бот для расписания КГУ им. К.Э. Циолковского.
Открывает Mini App с расписанием студентов и преподавателей.
Поддерживает текстовый вывод расписания на сегодня / неделю.
Поддерживает режим работы в группах, авто-рассылку расписания и фоновую автозагрузку данных.

Запуск:
    1. Заполните .env по образцу .env.example
    2. pip install -r bot/requirements.txt (или requirements.txt)
    3. python bot/bot.py (или python bot.py)
"""

import asyncio
import json
import logging
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

# Гарантируем видимость локальных модулей из директории бота (db.py)
BOT_DIR = Path(__file__).resolve().parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import db

# Загружаем .env из директории бота или корня проекта
load_dotenv(BOT_DIR.parent / ".env")
load_dotenv(BOT_DIR / ".env")
load_dotenv()

from telegram import (
    BotCommandScopeChat,
    BotCommandScopeDefault,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Update,
    WebAppInfo,
)
from telegram.constants import ChatMemberStatus, ChatType
from telegram.error import BadRequest, Forbidden
from telegram.ext import (
    ApplicationBuilder,
    CallbackQueryHandler,
    ChatMemberHandler,
    CommandHandler,
    ContextTypes,
)

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"]

ROOT_DIR = BOT_DIR.parent
DEFAULT_DATA_DIR = ROOT_DIR / "data" if (ROOT_DIR / "data").exists() else BOT_DIR / "data"
DATA_DIR = Path(os.environ.get("DATA_DIR", DEFAULT_DATA_DIR))

ADMIN_IDS: set[int] = set()
for _key in ("ADMIN_ID", "admin_id", "ADMIN_IDS", "admin_ids", "BOT_ADMIN_ID"):
    _val = os.environ.get(_key, "").strip()
    if _val:
        _val = _val.strip("\"'")
        for _part in _val.replace(",", " ").replace(";", " ").split():
            _clean = re.sub(r"[^\d-]", "", _part)
            if _clean and (_clean.isdigit() or (_clean.startswith("-") and _clean[1:].isdigit())):
                ADMIN_IDS.add(int(_clean))

ADMIN_ID = next(iter(ADMIN_IDS)) if ADMIN_IDS else None

AUTO_FETCH_ENABLED = os.environ.get("AUTO_FETCH_ENABLED", "true").lower() in ("true", "1", "yes")
AUTO_FETCH_TIME = os.environ.get("AUTO_FETCH_TIME", "04:00")

DEFAULT_FETCH_SCRIPT = (
    BOT_DIR / "scripts" / "new_script.py"
    if (BOT_DIR / "scripts" / "new_script.py").exists()
    else (
        ROOT_DIR / "scripts" / "new_script.py"
        if (ROOT_DIR / "scripts" / "new_script.py").exists()
        else Path("scripts/new_script.py")
    )
)
FETCH_SCRIPT = os.environ.get("FETCH_SCRIPT", str(DEFAULT_FETCH_SCRIPT))

TOKEN_STUDENTS = os.environ.get("TOKEN_STUDENTS", "")
TOKEN_TEACHERS = os.environ.get("TOKEN_TEACHERS", "")

MOSCOW_TZ = ZoneInfo("Europe/Moscow")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]

# Флаг для предотвращения параллельного скачивания
_is_fetching = False
_last_auto_fetch_date: str | None = None

# ── Индексы групп и преподавателей ──

_groups_index: dict[str, list[dict]] = {}  # name_lower -> [{id, name, dept}]
_staff_index: dict[str, list[dict]] = {}   # name_lower -> [{id, name, dept}]


def _build_indexes() -> None:
    """Строит плоские индексы из students.json и teachers.json."""
    global _groups_index, _staff_index

    new_groups: dict[str, list[dict]] = {}
    new_staff: dict[str, list[dict]] = {}

    # Группы
    stu_path = DATA_DIR / "students.json"
    if stu_path.exists():
        try:
            with open(stu_path, encoding="utf-8") as f:
                stu = json.load(f)
            dept_items = stu.values() if isinstance(stu, dict) else (stu if isinstance(stu, list) else [])
            for dept in dept_items:
                if not isinstance(dept, dict):
                    continue
                dept_name = dept.get("name", "")
                courses = dept.get("items", {})
                course_items = courses.values() if isinstance(courses, dict) else (courses if isinstance(courses, list) else [])
                for course in course_items:
                    if not isinstance(course, dict):
                        continue
                    groups = course.get("items", {})
                    group_items = groups.values() if isinstance(groups, dict) else (groups if isinstance(groups, list) else [])
                    for g in group_items:
                        if not isinstance(g, dict):
                            continue
                        name = g.get("name", "")
                        if not name:
                            continue
                        key = name.lower()
                        new_groups.setdefault(key, []).append(
                            {"id": str(g["id"]), "name": name, "dept": dept_name}
                        )
        except Exception as e:
            logger.error("Ошибка чтения students.json: %s", e)

    # Преподаватели
    tch_path = DATA_DIR / "teachers.json"
    if tch_path.exists():
        try:
            with open(tch_path, encoding="utf-8") as f:
                tch = json.load(f)
            departments = tch.get("departments", {}) if isinstance(tch, dict) else {}
            staff_dict = tch.get("staff", {}) if isinstance(tch, dict) else {}
            if isinstance(staff_dict, dict):
                for dept_id, members in staff_dict.items():
                    dept_name = departments.get(dept_id, "") if isinstance(departments, dict) else ""
                    member_items = members.items() if isinstance(members, dict) else []
                    for sid, info in member_items:
                        name = info.get("shortName", "") if isinstance(info, dict) else str(info)
                        if not name:
                            continue
                        key = name.lower()
                        new_staff.setdefault(key, []).append(
                            {"id": str(sid), "name": name, "dept": dept_name}
                        )
        except Exception as e:
            logger.error("Ошибка чтения teachers.json: %s", e)

    _groups_index = new_groups
    _staff_index = new_staff


def _search(index: dict, query: str, limit: int = 10) -> list[dict]:
    """Ищет по подстроке в индексе, возвращает уникальные результаты."""
    q = query.lower().strip()
    if not q:
        return []
    seen = set()
    results = []
    for key, items in index.items():
        if q in key:
            for item in items:
                uid = item["id"]
                if uid not in seen:
                    seen.add(uid)
                    results.append(item)
                    if len(results) >= limit:
                        return results
    return results


# ── Загрузка расписания ──

def _load_schedule(kind: str, entity_id: str, month: int, year: int) -> dict | None:
    """Загружает JSON расписания. kind = 's' (студенты) или 't' (преподаватели)."""
    path = DATA_DIR / kind / entity_id / f"{month}_{year}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("Не удалось прочитать %s: %s", path, e)
        return None


def _lessons_for_date(data: dict, target: date) -> list[dict]:
    """Возвращает отсортированные пары на конкретную дату."""
    date_str = target.strftime("%d.%m.%Y")
    lessons = [le for le in data.get("lessons", []) if le.get("date") == date_str and not le.get("is_empty")]
    lessons.sort(key=lambda le: le.get("lesson_time_id", 0))
    return lessons


def _format_lesson(lesson: dict) -> str:
    """Форматирует одну пару в текстовую строку."""
    time = lesson.get("lessonTime", "")
    disc = lesson.get("discipline", "—")
    ctype = lesson.get("class_type_name", "")
    room = re.sub(r"<[^>]*>", "", lesson.get("classroom", "")).strip()
    staff = ", ".join(lesson.get("staffNames", []))
    group = lesson.get("groupName", "")

    parts = [f"⏰ {time}"]
    parts.append(f"📚 {disc}")
    if ctype:
        parts.append(f"   Тип: {ctype}")
    if staff:
        parts.append(f"   👤 {staff}")
    if group:
        parts.append(f"   👥 {group}")
    if room:
        parts.append(f"   🏫 {room}")
    return "\n".join(parts)


def _format_day(target: date, lessons: list[dict]) -> str:
    """Форматирует расписание на один день."""
    wd = WEEKDAYS[target.weekday()]
    header = f"📅 *{wd}, {target.strftime('%d.%m.%Y')}*"
    if not lessons:
        return header + "\n\n_Нет занятий_"
    body = "\n\n".join(_format_lesson(le) for le in lessons)
    return header + "\n\n" + body


def _get_schedule_text(kind: str, entity_id: str, days: list[date]) -> str:
    """Собирает текстовое расписание на список дат."""
    months_needed = {(d.month, d.year) for d in days}
    data_by_month = {}
    for m, y in months_needed:
        data = _load_schedule(kind, entity_id, m, y)
        if data:
            data_by_month[(m, y)] = data

    if not data_by_month:
        return "📭 Нет данных за этот период."

    parts = []
    for day in days:
        data = data_by_month.get((day.month, day.year))
        lessons = _lessons_for_date(data, day) if data else []
        parts.append(_format_day(day, lessons))

    return "\n\n———\n\n".join(parts)


async def _send_long_message(message, text: str, parse_mode: str = "Markdown", reply_markup=None) -> None:
    """Отправляет длинное сообщение, разделяя его по дням при необходимости (лимит 4096 символов)."""
    if len(text) <= 3900:
        await message.reply_text(text, parse_mode=parse_mode, reply_markup=reply_markup)
        return

    day_parts = text.split("\n\n———\n\n")
    chunks = []
    curr = ""
    for part in day_parts:
        if len(curr) + len(part) + 10 > 3900:
            if curr:
                chunks.append(curr)
            curr = part
        else:
            curr = curr + ("\n\n———\n\n" if curr else "") + part
    if curr:
        chunks.append(curr)

    for i, chunk in enumerate(chunks):
        markup = reply_markup if i == len(chunks) - 1 else None
        await message.reply_text(chunk, parse_mode=parse_mode, reply_markup=markup)


# ── Проверка прав администратора в группах ──

async def is_user_admin(chat, user_id: int, bot) -> bool:
    """Проверяет, является ли пользователь администратором группы (в ЛС всегда True)."""
    if chat.type == ChatType.PRIVATE:
        return True
    try:
        member = await bot.get_chat_member(chat.id, user_id)
        return member.status in (ChatMemberStatus.OWNER, ChatMemberStatus.ADMINISTRATOR)
    except Exception as e:
        logger.warning("Не удалось проверить права пользователя %s в чате %s: %s", user_id, chat.id, e)
        return False


# ── Фоновое обновление расписания ──

async def trigger_schedule_fetch(app=None) -> tuple[bool, str]:
    """Запускает скрипт загрузки расписания в отдельном асинхронном подпроцессе."""
    global _is_fetching

    if _is_fetching:
        return False, "Обновление уже выполняется в фоновом режиме."

    if not TOKEN_STUDENTS or not TOKEN_TEACHERS:
        return False, "Не заданы TOKEN_STUDENTS или TOKEN_TEACHERS в конфигурации .env"

    script_path = Path(FETCH_SCRIPT)
    if not script_path.exists():
        fallback = BOT_DIR / "scripts" / "new_script.py"
        if not fallback.exists():
            fallback = ROOT_DIR / "scripts" / "new_script.py"
        if fallback.exists():
            script_path = fallback
        else:
            return False, f"Скрипт загрузки {FETCH_SCRIPT} не найден."

    _is_fetching = True
    logger.info("Запуск фоновой автозагрузки расписания через %s...", script_path)

    try:
        env = dict(os.environ)
        env["DATA_DIR"] = str(DATA_DIR)
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            str(script_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        stdout, stderr = await proc.communicate()

        if proc.returncode == 0:
            _build_indexes()
            msg = (
                f"✅ Расписание успешно обновлено с API APEKS!\n"
                f"Индексы перезагружены: {len(_groups_index)} групп, {len(_staff_index)} преподавателей."
            )
            logger.info(msg)
            if ADMIN_ID and app:
                try:
                    await app.bot.send_message(chat_id=ADMIN_ID, text=msg)
                except Exception as e:
                    logger.warning("Не удалось отправить отчет администратору: %s", e)
            return True, msg
        else:
            err_text = stderr.decode("utf-8", errors="replace")[-500:]
            msg = f"❌ Ошибка обновления расписания (код {proc.returncode}):\n{err_text}"
            logger.error(msg)
            if ADMIN_ID and app:
                try:
                    await app.bot.send_message(chat_id=ADMIN_ID, text=msg)
                except Exception as e:
                    logger.warning("Не удалось отправить ошибку администратору: %s", e)
            return False, msg
    except Exception as e:
        logger.exception("Исключение при запуске скрипта обновления: %s", e)
        return False, f"Исключение при обновлении: {e}"
    finally:
        _is_fetching = False


# ── Фоновый планировщик задач (JobQueue) ──

async def scheduled_notifications_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Ежеминутная проверка и отправка запланированных расписаний."""
    now = datetime.now(MOSCOW_TZ)
    current_time_str = now.strftime("%H:%M")
    current_date_str = now.strftime("%Y-%m-%d")

    due_chats = db.get_due_notifications(current_time_str, current_date_str)
    if not due_chats:
        return

    logger.info("Отправка расписания для %d чатов на время %s...", len(due_chats), current_time_str)

    for item in due_chats:
        chat_id = item["chat_id"]
        target_day_mode = item["target_day"]
        skip_empty = item["skip_empty"]
        kind = item["kind"]
        entity_id = item["entity_id"]
        entity_name = item["entity_name"]

        # Определение целевой даты
        if target_day_mode == "today":
            target_date = now.date()
            label = "на сегодня"
        elif target_day_mode == "tomorrow":
            target_date = now.date() + timedelta(days=1)
            label = "на завтра"
        else:  # auto
            if now.hour < 14:
                target_date = now.date()
                label = "на сегодня"
            else:
                target_date = now.date() + timedelta(days=1)
                label = "на завтра"

        # Загрузка занятий
        data = _load_schedule(kind, entity_id, target_date.month, target_date.year)
        lessons = _lessons_for_date(data, target_date) if data else []

        if not lessons and skip_empty:
            db.mark_notification_sent(chat_id, current_date_str)
            continue

        text = (
            f"⏰ *Ежедневное расписание {label}*\n"
            f"📌 *{entity_name}*\n\n"
            + _format_day(target_date, lessons)
        )

        try:
            await context.bot.send_message(chat_id=chat_id, text=text, parse_mode="Markdown")
            db.mark_notification_sent(chat_id, current_date_str)
        except Forbidden:
            logger.info("Бот заблокирован в чате %s, отключаем рассылку", chat_id)
            db.disable_notification(chat_id)
        except BadRequest as e:
            logger.warning("Ошибка отправки расписания в чат %s: %s", chat_id, e)
            if "chat not found" in str(e).lower():
                db.disable_notification(chat_id)
        except Exception as e:
            logger.error("Непредвиденная ошибка отправки расписания в чат %s: %s", chat_id, e)


async def scheduled_data_fetch_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Ежедневная автозагрузка расписания в заданное время."""
    global _last_auto_fetch_date

    if not AUTO_FETCH_ENABLED:
        return

    now = datetime.now(MOSCOW_TZ)
    current_time_str = now.strftime("%H:%M")
    current_date_str = now.strftime("%Y-%m-%d")

    if current_time_str == AUTO_FETCH_TIME and _last_auto_fetch_date != current_date_str:
        _last_auto_fetch_date = current_date_str
        logger.info("Наступило время автозагрузки расписания (%s МСК)...", AUTO_FETCH_TIME)
        await trigger_schedule_fetch(context.application)


# ── Обработчик добавления бота в группу ──

async def chat_member_updated(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Приветствие при добавлении бота в группу / отключение при удалении."""
    result = update.my_chat_member
    if not result:
        return

    old_status = result.old_chat_member.status
    new_status = result.new_chat_member.status
    chat = update.effective_chat
    if not chat:
        return

    db.register_chat(chat.id, chat_type=chat.type, title=chat.title or chat.effective_name or "")

    if new_status in (ChatMemberStatus.MEMBER, ChatMemberStatus.ADMINISTRATOR) and old_status in (
        ChatMemberStatus.LEFT,
        ChatMemberStatus.BANNED,
        ChatMemberStatus.RESTRICTED,
    ):
        welcome_text = (
            "👋 *Всем привет! Я бот расписания КГУ им. К.Э. Циолковского.*\n\n"
            "Рад присоединиться к вашей группе! Вот как со мной работать:\n\n"
            "1️⃣ *Привязка расписания к группе:*\n"
            "Администратор чата может выбрать учебную группу или преподавателя:\n"
            "• `/setgroup Название` — например, `/setgroup Б-Инф-31`\n"
            "• `/setteacher Фамилия` — например, `/setteacher Иванов`\n\n"
            "2️⃣ *Просмотр расписания (доступно всем участникам):*\n"
            "• `/today` — расписание на сегодня\n"
            "• `/tomorrow` — расписание на завтра\n"
            "• `/week` — расписание на текущую неделю\n\n"
            "3️⃣ *Автоматическая рассылка:*\n"
            "• `/notify 08:00` — бот будет автоматически отправлять расписание каждое утро\n"
            "• `/notify` — интерактивные настройки рассылки\n\n"
            "ℹ️ Настройки этого чата: `/settings` | Справка: `/help`"
        )
        try:
            await ctx.bot.send_message(chat_id=chat.id, text=welcome_text, parse_mode="Markdown")
        except Exception as e:
            logger.warning("Не удалось отправить приветствие в группу %s: %s", chat.id, e)

    elif new_status in (ChatMemberStatus.LEFT, ChatMemberStatus.BANNED):
        db.disable_notification(chat.id)
        logger.info("Бот удален из группы %s (%s), уведомления отключены", chat.id, chat.title)


# ── Команды бота ──

async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if chat:
        db.register_chat(chat.id, chat_type=chat.type, title=chat.title or chat.effective_name or "")

    if chat and chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        pref = db.get_chat_pref(chat.id)
        pref_text = f"Сейчас для группы выбрано: *{pref['name']}*" if pref else "Группа/преподаватель ещё не выбраны."
        await update.message.reply_text(
            f"👋 Бот расписания КГУ им. К.Э. Циолковского активен в этой группе!\n\n"
            f"ℹ️ {pref_text}\n\n"
            f"Используйте /today, /tomorrow, /week для просмотра.\n"
            f"Используйте /settings для проверки настроек чата.",
            parse_mode="Markdown",
        )
        return

    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("📱 Открыть расписание", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await update.message.reply_text(
        "Привет! 👋\n\n"
        "Я — бот расписания КГУ им. К.Э. Циолковского.\n\n"
        "Вы можете привязать группу или преподавателя и смотреть расписание прямо в чате, "
        "а также настроить автоматическую утреннюю рассылку расписания!\n\n"
        "Используйте /help для списка всех доступных команд.",
        reply_markup=keyboard,
    )


async def help_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    user = update.effective_user
    pref = db.get_chat_pref(chat.id) if chat else None
    current = f"Сейчас выбрано: *{pref['name']}*" if pref else "Группа/преподаватель не выбраны."

    is_group = chat and chat.type in (ChatType.GROUP, ChatType.SUPERGROUP)
    admin_note = " _(только администраторы)_" if is_group else ""

    admin_section = "\n\n👑 *Команды администратора:* /admin" if user and is_bot_admin(user.id) else ""

    text = (
        "📋 *Справка по командам*\n\n"
        "*Выбор расписания:*\n"
        f"/setgroup `название` — выбрать группу{admin_note}\n"
        f"/setteacher `фамилия` — выбрать преподавателя{admin_note}\n\n"
        "*Просмотр расписания:*\n"
        "/today — расписание на сегодня (или `/today Б-Инф-31`)\n"
        "/tomorrow — расписание на завтра\n"
        "/week — расписание на текущую неделю\n\n"
        "*Авто-рассылка:*\n"
        f"/notify — настройки рассылки в заданное время{admin_note}\n"
        f"/notify `08:00` — быстро включить рассылку на 08:00 МСК\n"
        f"/notify off — отключить авто-рассылку\n\n"
        "*Общая информация:*\n"
        "/settings — текущие настройки этого чата\n"
        "/status — дата обновления расписания\n"
        "/start — главное меню и Mini App\n\n"
        f"ℹ️ {current}"
        f"{admin_section}"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def settings_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if not chat:
        return
    pref = db.get_chat_pref(chat.id)
    notif = db.get_notification(chat.id)

    chat_type_label = "Группа" if chat.type in (ChatType.GROUP, ChatType.SUPERGROUP) else "Личные сообщения"
    target_day_labels = {"today": "На сегодня", "tomorrow": "На завтра", "auto": "Автоматически"}

    entity_str = f"*{pref['name']}*" if pref else "_Не выбрано (установите через /setgroup)_"

    if notif and notif["is_enabled"]:
        day_mode = target_day_labels.get(notif["target_day"], notif["target_day"])
        skip_str = "Да" if notif["skip_empty"] else "Нет"
        notif_str = f"Включена ✅ ({notif['notify_time']} МСК, {day_mode}, пропуск без пар: {skip_str})"
    else:
        notif_str = "Отключена 🔕 (включите через /notify)"

    text = (
        f"⚙️ *Настройки для этого чата*\n\n"
        f"• *Тип чата:* {chat_type_label}\n"
        f"• *Название:* {chat.title or chat.effective_name}\n"
        f"• *Расписание:* {entity_str}\n"
        f"• *Авто-рассылка:* {notif_str}\n\n"
        f"Для изменения расписания используйте /setgroup или /setteacher.\n"
        f"Для управления рассылкой используйте /notify."
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def set_group(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    user = update.effective_user
    if not chat or not user:
        return

    if chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        if not await is_user_admin(chat, user.id, ctx.bot):
            await update.message.reply_text("🔒 Изменять группу могут только администраторы этого чата.")
            return

    query = " ".join(ctx.args) if ctx.args else ""
    if not query:
        await update.message.reply_text(
            "Использование: /setgroup `название группы`\nПример: `/setgroup Б-Инф-31`",
            parse_mode="Markdown",
        )
        return

    results = _search(_groups_index, query)
    if not results:
        await update.message.reply_text(f"❌ Группа «{query}» не найдена в базе.")
        return

    chat_title = chat.title or chat.effective_name or ""

    if len(results) == 1:
        r = results[0]
        db.set_chat_pref(chat.id, "s", r["id"], r["name"], chat_type=chat.type, title=chat_title)
        await update.message.reply_text(
            f"✅ Группа *{r['name']}* сохранена для этого чата.\n\n"
            f"Теперь используйте /today, /tomorrow или /week.",
            parse_mode="Markdown",
        )
        return

    buttons = [
        [InlineKeyboardButton(f"{r['name']} ({r['dept'][:25]})", callback_data=f"sg:{r['id']}:{r['name']}")]
        for r in results[:10]
    ]
    await update.message.reply_text(
        f"🔍 Найдено несколько групп по запросу «{query}».\nВыберите нужную:",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def set_teacher(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    user = update.effective_user
    if not chat or not user:
        return

    if chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        if not await is_user_admin(chat, user.id, ctx.bot):
            await update.message.reply_text("🔒 Изменять преподавателя могут только администраторы этого чата.")
            return

    query = " ".join(ctx.args) if ctx.args else ""
    if not query:
        await update.message.reply_text(
            "Использование: /setteacher `фамилия`\nПример: `/setteacher Иванов`",
            parse_mode="Markdown",
        )
        return

    results = _search(_staff_index, query)
    if not results:
        await update.message.reply_text(f"❌ Преподаватель «{query}» не найден в базе.")
        return

    chat_title = chat.title or chat.effective_name or ""

    if len(results) == 1:
        r = results[0]
        db.set_chat_pref(chat.id, "t", r["id"], r["name"], chat_type=chat.type, title=chat_title)
        await update.message.reply_text(
            f"✅ Преподаватель *{r['name']}* сохранён для этого чата.\n\n"
            f"Теперь используйте /today, /tomorrow или /week.",
            parse_mode="Markdown",
        )
        return

    buttons = [
        [InlineKeyboardButton(f"{r['name']} ({r['dept'][:25]})", callback_data=f"st:{r['id']}:{r['name']}")]
        for r in results[:10]
    ]
    await update.message.reply_text(
        f"🔍 Найдено несколько преподавателей по запросу «{query}».\nВыберите нужного:",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def callback_select(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработка нажатий на кнопки выбора группы/преподавателя."""
    q = update.callback_query
    await q.answer()
    data = q.data or ""
    parts = data.split(":", 2)
    if len(parts) < 3:
        return

    chat = update.effective_chat
    user = update.effective_user
    if not chat or not user:
        return

    if chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        if not await is_user_admin(chat, user.id, ctx.bot):
            await q.answer("🔒 Выбирать расписание в группе могут только администраторы.", show_alert=True)
            return

    action, eid, name = parts
    chat_title = chat.title or chat.effective_name or ""

    if action == "sg":
        db.set_chat_pref(chat.id, "s", eid, name, chat_type=chat.type, title=chat_title)
        await q.edit_message_text(
            f"✅ Группа *{name}* сохранена для этого чата.\n\nИспользуйте /today или /week.",
            parse_mode="Markdown",
        )
    elif action == "st":
        db.set_chat_pref(chat.id, "t", eid, name, chat_type=chat.type, title=chat_title)
        await q.edit_message_text(
            f"✅ Преподаватель *{name}* сохранён для этого чата.\n\nИспользуйте /today или /week.",
            parse_mode="Markdown",
        )


# ── Интерактивное меню /notify ──

def _build_notify_keyboard(notif: dict | None) -> InlineKeyboardMarkup:
    """Строит инлайн-клавиатуру управления авто-рассылкой."""
    is_enabled = notif and notif["is_enabled"]
    target_day = notif["target_day"] if notif else "today"
    skip_empty = notif["skip_empty"] if notif else True

    toggle_btn = InlineKeyboardButton(
        "🔕 Отключить рассылку" if is_enabled else "🔔 Включить рассылку",
        callback_data="nt:toggle",
    )

    day_labels = {"today": "Сегодня ➡️ Завтра", "tomorrow": "Завтра ➡️ Авто", "auto": "Авто ➡️ Сегодня"}
    day_btn = InlineKeyboardButton(f"📅 День: {day_labels.get(target_day, 'Сегодня')}", callback_data="nt:cycleday")

    skip_btn = InlineKeyboardButton(
        f"🚫 Без пар: {'Пропускать' if skip_empty else 'Присылать'}",
        callback_data="nt:cycleskip",
    )

    times_morning = [
        InlineKeyboardButton("07:00", callback_data="nt:time:07:00"),
        InlineKeyboardButton("07:30", callback_data="nt:time:07:30"),
        InlineKeyboardButton("08:00", callback_data="nt:time:08:00"),
        InlineKeyboardButton("08:30", callback_data="nt:time:08:30"),
    ]
    times_evening = [
        InlineKeyboardButton("18:00", callback_data="nt:time:18:00"),
        InlineKeyboardButton("19:00", callback_data="nt:time:19:00"),
        InlineKeyboardButton("20:00", callback_data="nt:time:20:00"),
        InlineKeyboardButton("21:00", callback_data="nt:time:21:00"),
    ]

    refresh_btn = InlineKeyboardButton("🔄 Обновить", callback_data="nt:refresh")

    return InlineKeyboardMarkup([
        [toggle_btn],
        times_morning,
        times_evening,
        [day_btn, skip_btn],
        [refresh_btn],
    ])


def _build_notify_text(pref: dict | None, notif: dict | None) -> str:
    """Форматирует информационный текст карточки /notify."""
    entity_name = pref["name"] if pref else "Не выбрано ⚠️ (/setgroup)"
    is_enabled = notif and notif["is_enabled"]
    time_str = notif["notify_time"] if notif else "08:00"
    target_day = notif["target_day"] if notif else "today"
    skip_empty = notif["skip_empty"] if notif else True

    day_labels = {"today": "На текущий день", "tomorrow": "На следующий день", "auto": "Авто (утром — сегодня, вечером — завтра)"}

    return (
        "⏰ *Настройка авто-рассылки расписания*\n\n"
        f"📌 *Расписание:* {entity_name}\n"
        f"🔔 *Статус:* {'Включена ✅' if is_enabled else 'Отключена 🔕'}\n"
        f"⏰ *Время отправки:* *{time_str}* (по МСК)\n"
        f"📅 *Режим дня:* {day_labels.get(target_day, target_day)}\n"
        f"🚫 *Пропуск пустых дней:* {'Да (без спама)' if skip_empty else 'Нет'}\n\n"
        "_Выберите быстрое время на кнопках или введите своё:_\n"
        "`/notify 07:45` или `/notify 20:00 tomorrow`"
    )


async def notify_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    user = update.effective_user
    if not chat or not user:
        return

    if chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        if not await is_user_admin(chat, user.id, ctx.bot):
            await update.message.reply_text("🔒 Настраивать рассылку в группе могут только администраторы.")
            return

    pref = db.get_chat_pref(chat.id)
    if not pref:
        await update.message.reply_text(
            "⚠️ Сначала привяжите группу или преподавателя к этому чату через /setgroup или /setteacher.",
            parse_mode="Markdown",
        )
        return

    args = ctx.args or []
    if args:
        first = args[0].lower().strip()
        if first in ("off", "stop", "выкл", "откл"):
            db.disable_notification(chat.id)
            await update.message.reply_text("🔕 Авто-рассылка расписания отключена.")
            return
        if first in ("on", "вкл", "старт"):
            db.set_notification(chat.id, is_enabled=True)
            notif = db.get_notification(chat.id)
            await update.message.reply_text(
                f"🔔 Авто-рассылка включена на *{notif['notify_time']}* (МСК)!",
                parse_mode="Markdown",
            )
            return

        time_match = re.match(r"^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$", first)
        if time_match:
            hh = int(time_match.group(1))
            mm = int(time_match.group(2))
            time_str = f"{hh:02d}:{mm:02d}"

            target_day = "today"
            if len(args) > 1:
                arg2 = args[1].lower().strip()
                if arg2 in ("tomorrow", "завтра"):
                    target_day = "tomorrow"
                elif arg2 in ("today", "сегодня"):
                    target_day = "today"
                elif arg2 in ("auto", "авто"):
                    target_day = "auto"
            else:
                target_day = "tomorrow" if hh >= 15 else "today"

            db.set_notification(chat.id, is_enabled=True, notify_time=time_str, target_day=target_day)
            day_text = "на следующий день" if target_day == "tomorrow" else "на текущий день"
            await update.message.reply_text(
                f"✅ Авто-рассылка успешно настроена!\n\n"
                f"⏰ Время: *{time_str}* (по МСК)\n"
                f"📅 Режим: *{day_text}*\n"
                f"📌 Расписание: *{pref['name']}*",
                parse_mode="Markdown",
            )
            return

        await update.message.reply_text(
            "Неверный формат команды.\n"
            "Примеры:\n"
            "• `/notify 08:00`\n"
            "• `/notify 19:30 tomorrow`\n"
            "• `/notify off`\n"
            "• `/notify` — интерактивное меню",
            parse_mode="Markdown",
        )
        return

    notif = db.get_notification(chat.id)
    text = _build_notify_text(pref, notif)
    keyboard = _build_notify_keyboard(notif)
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)


async def callback_notify(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик нажатий в меню /notify."""
    q = update.callback_query
    await q.answer()
    data = q.data or ""
    chat = update.effective_chat
    user = update.effective_user
    if not chat or not user:
        return

    if chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        if not await is_user_admin(chat, user.id, ctx.bot):
            await q.answer("🔒 Настраивать рассылку в группе могут только администраторы.", show_alert=True)
            return

    parts = data.split(":")
    action = parts[1] if len(parts) > 1 else ""

    notif = db.get_notification(chat.id)
    if not notif:
        db.set_notification(chat.id, is_enabled=True, notify_time="08:00", target_day="today")
        notif = db.get_notification(chat.id)

    if action == "toggle":
        new_state = not notif["is_enabled"]
        db.update_notification_field(chat.id, "is_enabled", new_state)
    elif action == "time" and len(parts) >= 3:
        time_str = parts[2]
        db.update_notification_field(chat.id, "notify_time", time_str)
        db.update_notification_field(chat.id, "is_enabled", True)
    elif action == "cycleday":
        next_day = {"today": "tomorrow", "tomorrow": "auto", "auto": "today"}
        cur_day = notif.get("target_day", "today")
        db.update_notification_field(chat.id, "target_day", next_day.get(cur_day, "today"))
    elif action == "cycleskip":
        db.update_notification_field(chat.id, "skip_empty", not notif["skip_empty"])
    elif action == "refresh":
        pass

    updated_notif = db.get_notification(chat.id)
    pref = db.get_chat_pref(chat.id)
    text = _build_notify_text(pref, updated_notif)
    keyboard = _build_notify_keyboard(updated_notif)

    try:
        await q.edit_message_text(text, parse_mode="Markdown", reply_markup=keyboard)
    except BadRequest as e:
        if "message is not modified" not in str(e).lower():
            logger.warning("Ошибка обновления меню notify: %s", e)


# ── Просмотр расписания (today, tomorrow, week) ──

def _resolve_entity(chat_id: int, query: str = "") -> tuple[str, str, str] | None:
    """Возвращает (kind, entity_id, name) для запроса или текущего чата."""
    if query:
        res_g = _search(_groups_index, query, limit=1)
        if res_g:
            return "s", res_g[0]["id"], res_g[0]["name"]
        res_t = _search(_staff_index, query, limit=1)
        if res_t:
            return "t", res_t[0]["id"], res_t[0]["name"]
        return None

    pref = db.get_chat_pref(chat_id)
    if pref:
        return pref["kind"], pref["id"], pref["name"]
    return None


async def today_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if not chat:
        return
    query = " ".join(ctx.args).strip() if ctx.args else ""
    target_info = _resolve_entity(chat.id, query)

    if not target_info:
        if query:
            await update.message.reply_text(f"❌ Ничего не найдено по запросу «{query}».")
        else:
            hint = (
                "⚠️ Для этой группы ещё не выбрано расписание.\n"
                "Администратор может выбрать группу: `/setgroup Б-Инф-31`\n\n"
                "Или вы можете указать группу сразу: `/today Б-Инф-31`"
                if chat.type in (ChatType.GROUP, ChatType.SUPERGROUP)
                else "⚠️ Сначала выберите группу: /setgroup `название` или укажите её сразу: `/today Б-Инф-31`"
            )
            await update.message.reply_text(hint, parse_mode="Markdown")
        return

    kind, eid, name = target_info
    today = date.today()
    text = f"📌 *{name}*\n\n" + _get_schedule_text(kind, eid, [today])
    await _send_long_message(update.message, text, parse_mode="Markdown")


async def tomorrow_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if not chat:
        return
    query = " ".join(ctx.args).strip() if ctx.args else ""
    target_info = _resolve_entity(chat.id, query)

    if not target_info:
        if query:
            await update.message.reply_text(f"❌ Ничего не найдено по запросу «{query}».")
        else:
            hint = (
                "⚠️ Для этого чата не выбрано расписание.\nИспользуйте /setgroup или укажите группу: `/tomorrow Б-Инф-31`"
            )
            await update.message.reply_text(hint, parse_mode="Markdown")
        return

    kind, eid, name = target_info
    tmrw = date.today() + timedelta(days=1)
    text = f"📌 *{name}*\n\n" + _get_schedule_text(kind, eid, [tmrw])
    await _send_long_message(update.message, text, parse_mode="Markdown")


async def week_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if not chat:
        return
    query = " ".join(ctx.args).strip() if ctx.args else ""
    target_info = _resolve_entity(chat.id, query)

    if not target_info:
        if query:
            await update.message.reply_text(f"❌ Ничего не найдено по запросу «{query}».")
        else:
            hint = (
                "⚠️ Для этого чата не выбрано расписание.\nИспользуйте /setgroup или укажите группу: `/week Б-Инф-31`"
            )
            await update.message.reply_text(hint, parse_mode="Markdown")
        return

    kind, eid, name = target_info
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    days = [monday + timedelta(days=i) for i in range(6)]  # Пн–Сб
    text = f"📌 *{name}* — неделя {monday.strftime('%d.%m')}–{days[-1].strftime('%d.%m')}\n\n"
    text += _get_schedule_text(kind, eid, days)
    await _send_long_message(update.message, text, parse_mode="Markdown")


# ── Служебные команды (status) и команды администратора ──

def is_bot_admin(user_id: int | None) -> bool:
    """Проверяет, является ли пользователь администратором бота."""
    return bool(user_id and user_id in ADMIN_IDS)


async def status_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Публичная команда: отображает дату последнего обновления расписания."""
    meta_path = DATA_DIR / "meta.json"
    gen_date = "нет данных"
    if meta_path.exists():
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
            gen_date = meta.get("generated", "—")
        except Exception:
            pass

    text = (
        "📅 *Информация о расписании*\n\n"
        f"• Дата последнего обновления данных: *{gen_date}*\n\n"
        "_Расписание синхронизируется с сервером университета автоматически._"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def admin_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Панель администратора: список специальных команд управления."""
    user = update.effective_user
    if not user:
        return

    if not is_bot_admin(user.id):
        if not ADMIN_IDS:
            await update.message.reply_text(
                "⚠️ *Администратор бота не настроен!*\n\n"
                f"Ваш Telegram ID: `{user.id}`\n\n"
                "Чтобы получить доступ, укажите ваш ID в файле `.env` на сервере:\n"
                f"`ADMIN_ID={user.id}`\n\n"
                "После этого перезапустите контейнер:\n"
                "`docker compose down && docker compose up -d`",
                parse_mode="Markdown",
            )
        else:
            await update.message.reply_text(
                f"🔒 Эта команда доступна только администратору бота.\n\n"
                f"Ваш Telegram ID: `{user.id}`",
                parse_mode="Markdown",
            )
        return

    text = (
        "👑 *Панель администратора бота*\n\n"
        "Список специальных команд управления:\n\n"
        "📊 *Статистика и мониторинг:*\n"
        "• `/admin_status` — детальная статистика (число групп, преподавателей, чатов, рассылок)\n\n"
        "📢 *Массовая рассылка:*\n"
        "• `/broadcast <текст>` — разослать важное сообщение во все подключенные чаты (пользователям и группам)\n\n"
        "🔄 *Синхронизация данных:*\n"
        "• `/update_data` — запустить немедленное фоновое обновление расписания с API APEKS\n"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def admin_status_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Детальная статистика бота (доступно только администратору)."""
    user = update.effective_user
    if not user or not is_bot_admin(user.id):
        await update.message.reply_text("🔒 Эта команда доступна только администратору бота.")
        return

    stats = db.get_stats()
    meta_path = DATA_DIR / "meta.json"
    gen_date = "нет данных"
    if meta_path.exists():
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
            gen_date = meta.get("generated", "—")
        except Exception:
            pass

    auto_fetch_str = f"Включена ({AUTO_FETCH_TIME} МСК)" if AUTO_FETCH_ENABLED else "Отключена"

    text = (
        "📊 *Детальная статистика бота (Admin)*\n\n"
        f"• 📚 Учебных групп в индексе: *{len(_groups_index)}*\n"
        f"• 👨‍🏫 Преподавателей в индексе: *{len(_staff_index)}*\n"
        f"• 📅 Дата выгрузки расписания: *{gen_date}*\n\n"
        f"• 💬 Всего подключенных чатов: *{stats['total_chats']}*\n"
        f"  - Из них групп/супергрупп: *{stats['group_chats']}*\n"
        f"  - Личных диалогов: *{stats['private_chats']}*\n"
        f"  - С настроенным расписанием: *{stats['configured_chats']}*\n\n"
        f"• ⏰ Активных авто-рассылок: *{stats['active_notifications']}*\n"
        f"• 🔄 Ежедневная автозагрузка: *{auto_fetch_str}*"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def broadcast_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Рассылка сообщения администратора всем пользователям и группам бота."""
    user = update.effective_user
    if not user or not is_bot_admin(user.id):
        await update.message.reply_text("🔒 Эта команда доступна только администратору бота.")
        return

    text_to_send = " ".join(ctx.args).strip() if ctx.args else ""
    if not text_to_send:
        await update.message.reply_text(
            "Использование: `/broadcast <текст сообщения>`\n\n"
            "Пример:\n"
            "`/broadcast ⚠️ Внимание! Расписание на завтра обновлено.`",
            parse_mode="Markdown",
        )
        return

    chats = db.get_all_chats()
    if not chats:
        await update.message.reply_text("📭 В базе пока нет зарегистрированных чатов.")
        return

    status_msg = await update.message.reply_text(
        f"⏳ Начинаю рассылку для {len(chats)} чатов...",
        parse_mode="Markdown",
    )

    formatted_message = (
        f"📢 *Объявление от администрации бота*\n\n"
        f"{text_to_send}"
    )

    sent = 0
    blocked = 0
    failed = 0

    for ch in chats:
        cid = ch["chat_id"]
        try:
            await ctx.bot.send_message(chat_id=cid, text=formatted_message, parse_mode="Markdown")
            sent += 1
            await asyncio.sleep(0.05)  # Безопасный интервал отправки
        except Forbidden:
            blocked += 1
            db.disable_notification(cid)
        except BadRequest as e:
            failed += 1
            if "chat not found" in str(e).lower():
                db.disable_notification(cid)
        except Exception as e:
            failed += 1
            logger.error("Ошибка рассылки в чат %s: %s", cid, e)

    report = (
        f"✅ *Рассылка завершена!*\n\n"
        f"• Всего получателей: *{len(chats)}*\n"
        f"• Успешно доставлено: *{sent}*\n"
        f"• Заблокировали бота / удалены: *{blocked}*\n"
        f"• Другие ошибки: *{failed}*"
    )
    await status_msg.edit_text(report, parse_mode="Markdown")


async def update_data_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Команда для ручного запуска фонового обновления расписания."""
    user = update.effective_user
    if not user or not is_bot_admin(user.id):
        await update.message.reply_text("🔒 Эта команда доступна только администратору бота.")
        return

    if not TOKEN_STUDENTS or not TOKEN_TEACHERS:
        await update.message.reply_text("❌ В файле .env не заданы TOKEN_STUDENTS или TOKEN_TEACHERS.")
        return

    await update.message.reply_text("⏳ Запущено фоновое обновление расписания... Бот продолжает отвечать на запросы.")
    success, msg = await trigger_schedule_fetch(ctx.application)
    await update.message.reply_text(msg)


# ── Инициализация приложения ──

async def post_init(app) -> None:
    """Устанавливает кнопку меню бота, индексы данных и фоновые задачи."""
    db.init_db()
    _build_indexes()
    logger.info("Индексы построены: %d групп, %d преподавателей", len(_groups_index), len(_staff_index))

    await app.bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="Расписание",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )
    )

    public_commands = [
        ("start", "Открыть расписание"),
        ("help", "Справка по всем командам"),
        ("today", "Расписание на сегодня"),
        ("tomorrow", "Расписание на завтра"),
        ("week", "Расписание на неделю"),
        ("notify", "Настройка утренней авто-рассылки"),
        ("settings", "Текущие настройки чата"),
        ("setgroup", "Выбрать группу"),
        ("setteacher", "Выбрать преподавателя"),
        ("status", "Дата обновления расписания"),
    ]
    await app.bot.set_my_commands(public_commands, scope=BotCommandScopeDefault())

    # Специальные команды для администраторов бота
    if ADMIN_IDS:
        logger.info("Авторизованные администраторы бота: %s", sorted(ADMIN_IDS))
        admin_commands = public_commands + [
            ("admin", "Панель администратора"),
            ("admin_status", "Детальная статистика бота"),
            ("broadcast", "Рассылка сообщения всем чатам"),
            ("update_data", "Обновить данные с API"),
        ]
        for aid in ADMIN_IDS:
            try:
                await app.bot.set_my_commands(admin_commands, scope=BotCommandScopeChat(chat_id=aid))
                logger.info("Установлено персональное меню администратора для ID %d", aid)
            except Exception as e:
                logger.warning("Не удалось установить меню администратора для ID %s: %s", aid, e)
    else:
        logger.warning("ADMIN_ID не задан в .env! Админ-команды будут недоступны.")

    if app.job_queue:
        app.job_queue.run_repeating(
            scheduled_notifications_job,
            interval=60,
            first=10,
            name="check_scheduled_notifications",
        )
        if AUTO_FETCH_ENABLED:
            app.job_queue.run_repeating(
                scheduled_data_fetch_job,
                interval=60,
                first=20,
                name="check_daily_data_fetch",
            )
        logger.info("JobQueue инициализирован: авто-рассылка и авто-обновление активны.")

        if AUTO_FETCH_ENABLED and not (DATA_DIR / "students.json").exists() and TOKEN_STUDENTS and TOKEN_TEACHERS:
            logger.info("Файл students.json отсутствует в %s. Запуск первичной загрузки расписания...", DATA_DIR)
            asyncio.create_task(trigger_schedule_fetch(app))


def main() -> None:
    app = (
        ApplicationBuilder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .build()
    )

    # Публичные команды
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("settings", settings_cmd))
    app.add_handler(CommandHandler("setgroup", set_group))
    app.add_handler(CommandHandler("setteacher", set_teacher))
    app.add_handler(CommandHandler("today", today_cmd))
    app.add_handler(CommandHandler("tomorrow", tomorrow_cmd))
    app.add_handler(CommandHandler("week", week_cmd))
    app.add_handler(CommandHandler("notify", notify_cmd))
    app.add_handler(CommandHandler("status", status_cmd))

    # Команды администратора
    app.add_handler(CommandHandler("admin", admin_cmd))
    app.add_handler(CommandHandler("admin_status", admin_status_cmd))
    app.add_handler(CommandHandler("broadcast", broadcast_cmd))
    app.add_handler(CommandHandler("update_data", update_data_cmd))
    app.add_handler(CommandHandler("reload_data", update_data_cmd))

    app.add_handler(CallbackQueryHandler(callback_select, pattern=r"^s[gt]:"))
    app.add_handler(CallbackQueryHandler(callback_notify, pattern=r"^nt:"))

    app.add_handler(ChatMemberHandler(chat_member_updated, ChatMemberHandler.MY_CHAT_MEMBER))

    logger.info("Бот расписания КГУ запускается...")
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
