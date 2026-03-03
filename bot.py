"""
Telegram-бот для расписания КГУ им. К.Э. Циолковского.
Открывает Mini App с расписанием студентов и преподавателей.

Запуск:
    1. Создайте .env по образцу .env.example
    2. pip install -r requirements.txt
    3. python bot.py
"""

import os
import logging

from dotenv import load_dotenv
from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Update,
    WebAppInfo,
)
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
)

load_dotenv()

BOT_TOKEN = os.environ["BOT_TOKEN"]
# URL, по которому размещён ваш index.html (GitHub Pages, VPS + nginx и т.д.)
WEBAPP_URL = os.environ["WEBAPP_URL"]

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Приветствие с кнопками открытия Mini App."""
    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "📅 Расписание студентов",
                    web_app=WebAppInfo(url=WEBAPP_URL + "#students"),
                ),
            ],
            [
                InlineKeyboardButton(
                    "👨‍🏫 Расписание преподавателей",
                    web_app=WebAppInfo(url=WEBAPP_URL + "#teachers"),
                ),
            ],
        ]
    )
    await update.message.reply_text(
        "Привет! 👋\n\n"
        "Я — бот расписания КГУ им. К.Э. Циолковского.\n"
        "Выберите раздел:",
        reply_markup=keyboard,
    )


async def help_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "/start — открыть расписание\n"
        "/students — расписание студентов\n"
        "/teachers — расписание преподавателей\n"
        "/help — справка",
    )


async def students(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "📅 Открыть расписание",
                    web_app=WebAppInfo(url=WEBAPP_URL + "#students"),
                ),
            ],
        ]
    )
    await update.message.reply_text(
        "Расписание обучающихся:", reply_markup=keyboard
    )


async def teachers(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "👨‍🏫 Открыть расписание",
                    web_app=WebAppInfo(url=WEBAPP_URL + "#teachers"),
                ),
            ],
        ]
    )
    await update.message.reply_text(
        "Расписание преподавателей:", reply_markup=keyboard
    )


async def post_init(app) -> None:
    """Устанавливает кнопку меню бота — открытие Mini App."""
    await app.bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="📅 Расписание",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )
    )


def main() -> None:
    app = (
        ApplicationBuilder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .build()
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("students", students))
    app.add_handler(CommandHandler("teachers", teachers))

    logger.info("Бот запущен")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
