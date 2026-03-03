"""
Telegram-бот для расписания КГУ им. К.Э. Циолковского.
Открывает Mini App с расписанием студентов и преподавателей.
Поддерживает текстовый вывод расписания на сегодня / неделю.

Запуск:
    1. Создайте .env по образцу .env.example
    2. pip install -r requirements.txt
    3. python bot.py
"""

import json
import os
import logging
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
import asyncio

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Update,
    WebAppInfo,
)
from telegram.ext import (
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
)

load_dotenv()

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"]
DATA_DIR = Path(__file__).resolve().parent / "data"

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]

# ── Индексы групп и преподавателей ──

_groups_index: dict[str, list[dict]] = {}  # name_lower -> [{id, name, dept}]
_staff_index: dict[str, list[dict]] = {}   # name_lower -> [{id, name, dept}]


def _build_indexes() -> None:
    """Строит плоские индексы из students.json и teachers.json."""
    global _groups_index, _staff_index

    # Группы
    stu_path = DATA_DIR / "students.json"
    if stu_path.exists():
        with open(stu_path, encoding="utf-8") as f:
            stu = json.load(f)
        for dept in stu.values():
            dept_name = dept.get("name", "")
            for course in dept.get("items", {}).values():
                for g in course.get("items", {}).values():
                    name = g.get("name", "")
                    key = name.lower()
                    _groups_index.setdefault(key, []).append(
                        {"id": str(g["id"]), "name": name, "dept": dept_name}
                    )

    # Преподаватели
    tch_path = DATA_DIR / "teachers.json"
    if tch_path.exists():
        with open(tch_path, encoding="utf-8") as f:
            tch = json.load(f)
        departments = tch.get("departments", {})
        for dept_id, members in tch.get("staff", {}).items():
            dept_name = departments.get(dept_id, "")
            for sid, info in members.items():
                name = info.get("shortName", "") if isinstance(info, dict) else str(info)
                key = name.lower()
                _staff_index.setdefault(key, []).append(
                    {"id": sid, "name": name, "dept": dept_name}
                )


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
    with open(path, encoding="utf-8") as f:
        return json.load(f)


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
    room = lesson.get("classroom", "")
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


# ── Хранение выбора пользователя ──

_user_prefs: dict[int, dict] = {}  # user_id -> {"kind": "s"/"t", "id": ..., "name": ...}


def _get_pref(user_id: int) -> dict | None:
    return _user_prefs.get(user_id)


def _set_pref(user_id: int, kind: str, entity_id: str, name: str) -> None:
    _user_prefs[user_id] = {"kind": kind, "id": entity_id, "name": name}


# ── Обработчики команд ──

async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("📱 Открыть расписание", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await update.message.reply_text(
        "Привет! 👋\n\n"
        "Я — бот расписания КГУ им. К.Э. Циолковского.\n\n"
        "Используйте /help для списка команд.",
        reply_markup=keyboard,
    )


async def help_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    pref = _get_pref(update.effective_user.id)
    current = f"Сейчас выбрано: *{pref['name']}*" if pref else "Группа/преподаватель не выбраны."
    await update.message.reply_text(
        "📋 *Справка по командам*\n\n"
        "*Выбор группы / преподавателя:*\n"
        "/setgroup `название` — выбрать группу\n"
        "/setteacher `фамилия` — выбрать преподавателя\n\n"
        "*Расписание текстом:*\n"
        "/today — расписание на сегодня\n"
        "/tomorrow — расписание на завтра\n"
        "/week — расписание на текущую неделю\n\n"
        "*Mini App:*\n"
        "/start — открыть веб-приложение\n\n"
        f"ℹ️ {current}",
        parse_mode="Markdown",
    )


async def set_group(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    query = " ".join(ctx.args) if ctx.args else ""
    if not query:
        await update.message.reply_text("Использование: /setgroup `название группы`\nПример: /setgroup Б-Инф-31", parse_mode="Markdown")
        return

    results = _search(_groups_index, query)
    if not results:
        await update.message.reply_text(f"❌ Группа «{query}» не найдена.")
        return
    if len(results) == 1:
        r = results[0]
        _set_pref(update.effective_user.id, "s", r["id"], r["name"])
        await update.message.reply_text(f"✅ Группа *{r['name']}* сохранена.\n\nТеперь можете использовать /today или /week.", parse_mode="Markdown")
        return

    # Несколько результатов — показываем кнопки
    buttons = [
        [InlineKeyboardButton(f"{r['name']} ({r['dept'][:30]})", callback_data=f"sg:{r['id']}:{r['name']}")]
        for r in results
    ]
    await update.message.reply_text(
        f"🔍 Найдено несколько групп по запросу «{query}».\nВыберите нужную:",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def set_teacher(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    query = " ".join(ctx.args) if ctx.args else ""
    if not query:
        await update.message.reply_text("Использование: /setteacher `фамилия`\nПример: /setteacher Иванов", parse_mode="Markdown")
        return

    results = _search(_staff_index, query)
    if not results:
        await update.message.reply_text(f"❌ Преподаватель «{query}» не найден.")
        return
    if len(results) == 1:
        r = results[0]
        _set_pref(update.effective_user.id, "t", r["id"], r["name"])
        await update.message.reply_text(f"✅ Преподаватель *{r['name']}* сохранён.\n\nТеперь можете использовать /today или /week.", parse_mode="Markdown")
        return

    buttons = [
        [InlineKeyboardButton(f"{r['name']} ({r['dept'][:30]})", callback_data=f"st:{r['id']}:{r['name']}")]
        for r in results
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
    action, eid, name = parts
    user_id = q.from_user.id
    if action == "sg":
        _set_pref(user_id, "s", eid, name)
        await q.edit_message_text(f"✅ Группа *{name}* сохранена.\n\nИспользуйте /today или /week.", parse_mode="Markdown")
    elif action == "st":
        _set_pref(user_id, "t", eid, name)
        await q.edit_message_text(f"✅ Преподаватель *{name}* сохранён.\n\nИспользуйте /today или /week.", parse_mode="Markdown")


NO_PREF_MSG = "⚠️ Сначала выберите группу или преподавателя:\n/setgroup `название` или /setteacher `фамилия`"


async def today_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    pref = _get_pref(update.effective_user.id)
    if not pref:
        await update.message.reply_text(NO_PREF_MSG, parse_mode="Markdown")
        return
    today = date.today()
    text = f"📌 *{pref['name']}*\n\n" + _get_schedule_text(pref["kind"], pref["id"], [today])
    await update.message.reply_text(text, parse_mode="Markdown")


async def tomorrow_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    pref = _get_pref(update.effective_user.id)
    if not pref:
        await update.message.reply_text(NO_PREF_MSG, parse_mode="Markdown")
        return
    tmrw = date.today() + timedelta(days=1)
    text = f"📌 *{pref['name']}*\n\n" + _get_schedule_text(pref["kind"], pref["id"], [tmrw])
    await update.message.reply_text(text, parse_mode="Markdown")


async def week_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    pref = _get_pref(update.effective_user.id)
    if not pref:
        await update.message.reply_text(NO_PREF_MSG, parse_mode="Markdown")
        return
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    days = [monday + timedelta(days=i) for i in range(6)]  # Пн–Сб
    text = f"📌 *{pref['name']}* — неделя {monday.strftime('%d.%m')}–{days[-1].strftime('%d.%m')}\n\n"
    text += _get_schedule_text(pref["kind"], pref["id"], days)
    await update.message.reply_text(text, parse_mode="Markdown")


async def post_init(app) -> None:
    """Устанавливает кнопку меню бота и индексы данных."""
    _build_indexes()
    logger.info("Индексы: %d групп, %d преподавателей", len(_groups_index), len(_staff_index))
    await app.bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="Расписание",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )
    )
    await app.bot.set_my_commands([
        ("start", "Открыть расписание"),
        ("help", "Справка по командам"),
        ("setgroup", "Выбрать группу"),
        ("setteacher", "Выбрать преподавателя"),
        ("today", "Расписание на сегодня"),
        ("tomorrow", "Расписание на завтра"),
        ("week", "Расписание на неделю"),
    ])


def main() -> None:
    app = (
        ApplicationBuilder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .build()
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("setgroup", set_group))
    app.add_handler(CommandHandler("setteacher", set_teacher))
    app.add_handler(CommandHandler("today", today_cmd))
    app.add_handler(CommandHandler("tomorrow", tomorrow_cmd))
    app.add_handler(CommandHandler("week", week_cmd))
    app.add_handler(CallbackQueryHandler(callback_select, pattern=r"^s[gt]:"))

    logger.info("Бот запущен")
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
