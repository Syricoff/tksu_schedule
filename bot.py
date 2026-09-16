"""
Точка входа для запуска Telegram-бота расписания КГУ им. К.Э. Циолковского.
Исходный код бота находится в директории bot/.
"""

import sys
from pathlib import Path

# Добавляем директорию bot в путь поиска модулей
bot_dir = Path(__file__).resolve().parent / "bot"
if str(bot_dir) not in sys.path:
    sys.path.insert(0, str(bot_dir))

from bot import main

if __name__ == "__main__":
    main()
