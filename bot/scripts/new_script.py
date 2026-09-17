#!/usr/bin/env python3
"""
Скрипт предварительной загрузки расписания с API APEKS.

Особенности:
- ограничение глобальной скорости запросов;
- ограниченное количество одновременных запросов;
- корректная обработка HTTP 429;
- экспоненциальный backoff с jitter;
- уважение Retry-After;
- keep-alive соединения;
- ограниченная очередь задач;
- атомарная запись JSON;
- выходной формат полностью совместим со старым скриптом.

Запуск:
    python scripts/fetch_data.py

Или через переменные окружения:
    TOKEN_STUDENTS=...
    TOKEN_TEACHERS=...
    MONTHS_AHEAD=4
    WORKERS=6
    REQUESTS_PER_SECOND=4
    MAX_RETRIES=5
"""

import json
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from threading import Lock, local

import requests
from requests.adapters import HTTPAdapter

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


# ============================================================
# CONFIG
# ============================================================

API_STU = "https://apeks.tksu.ru/api/call/schedule-schedule/student"
API_TCH = "https://apeks.tksu.ru/api/call/schedule-schedule/staff"

TOKEN_STU = os.environ.get("TOKEN_STUDENTS", "")
TOKEN_TCH = os.environ.get("TOKEN_TEACHERS", "")

OUT_DIR = Path(os.environ.get("DATA_DIR", "data"))

MONTHS_AHEAD = int(os.environ.get("MONTHS_AHEAD", "1"))

# Количество одновременных соединений.
# 4-8 обычно значительно безопаснее, чем 16+.
WORKERS = max(1, int(os.environ.get("WORKERS", "6")))

# Максимальное количество запросов в секунду на ВЕСЬ скрипт,
# а не на отдельный поток.
REQUESTS_PER_SECOND = float(
    os.environ.get("REQUESTS_PER_SECOND", "4")
)

MAX_RETRIES = max(0, int(os.environ.get("MAX_RETRIES", "5")))

# Таймаут соединения и ответа.
CONNECT_TIMEOUT = float(os.environ.get("CONNECT_TIMEOUT", "10"))
READ_TIMEOUT = float(os.environ.get("READ_TIMEOUT", "60"))

# Максимальная задержка backoff.
MAX_BACKOFF = float(os.environ.get("MAX_BACKOFF", "30"))

# HTTP-коды, при которых имеет смысл повторить запрос.
RETRY_STATUS_CODES = {
    408,
    429,
    500,
    502,
    503,
    504,
}


# ============================================================
# GLOBAL STATE
# ============================================================

_print_lock = Lock()
_thread_local = local()

# Глобальный rate limiter.
_rate_lock = Lock()
_next_request_time = 0.0

# Глобальная пауза после 429/503.
_cooldown_lock = Lock()
_cooldown_until = 0.0


# ============================================================
# SESSION
# ============================================================

def _make_session():
    """
    Создаёт requests.Session для текущего потока.

    Важный момент:
    Здесь НЕ используется urllib3 Retry.

    Повторные запросы контролируем самостоятельно, чтобы:
    - видеть 429;
    - учитывать Retry-After;
    - соблюдать глобальный rate limit;
    - не получить неожиданные повторные запросы внутри adapter.
    """

    session = requests.Session()

    session.headers.update({
        "User-Agent": "TksuScheduleBot/2.0",
        "Accept": "application/json",
        "Connection": "keep-alive",
    })

    adapter = HTTPAdapter(
        pool_connections=WORKERS,
        pool_maxsize=WORKERS,
        max_retries=0,
    )

    session.mount("https://", adapter)

    return session


def get_session():
    """
    Один Session на поток.

    requests.Session не рекомендуется одновременно использовать
    из нескольких потоков, поэтому каждый worker получает свой.
    """

    session = getattr(_thread_local, "session", None)

    if session is None:
        session = _make_session()
        _thread_local.session = session

    return session


# ============================================================
# RATE LIMITER
# ============================================================

def wait_for_rate_limit():
    """
    Глобальный limiter.

    Например:

        REQUESTS_PER_SECOND = 4

    означает, что весь процесс делает примерно не более
    4 новых HTTP-запросов в секунду.

    Это НЕ 4 запроса на каждый worker.
    """

    global _next_request_time

    if REQUESTS_PER_SECOND <= 0:
        return

    interval = 1.0 / REQUESTS_PER_SECOND

    while True:
        now = time.monotonic()

        with _rate_lock:
            wait = _next_request_time - now

            if wait <= 0:
                _next_request_time = now + interval
                return

        time.sleep(wait)


def set_global_cooldown(seconds):
    """
    При 429/503 можно притормозить весь процесс.

    Это важно: если API начало отвечать 429,
    бессмысленно продолжать отправлять запросы
    из остальных потоков.
    """

    global _cooldown_until

    if seconds <= 0:
        return

    until = time.monotonic() + seconds

    with _cooldown_lock:
        if until > _cooldown_until:
            _cooldown_until = until


def wait_for_cooldown():
    """Ждёт глобальную паузу, если API попросило притормозить."""

    while True:
        with _cooldown_lock:
            remaining = _cooldown_until - time.monotonic()

        if remaining <= 0:
            return

        time.sleep(min(remaining, 1.0))


# ============================================================
# HTTP
# ============================================================

def parse_retry_after(response):
    """
    Читает Retry-After.

    Поддерживаются:
    - количество секунд;
    - HTTP-date.

    Если значение невозможно разобрать — возвращается None.
    """

    value = response.headers.get("Retry-After")

    if not value:
        return None

    # Самый распространённый вариант:
    # Retry-After: 5
    try:
        seconds = float(value)

        if seconds >= 0:
            return seconds

    except (TypeError, ValueError):
        pass

    # HTTP-date тоже разрешён стандартом.
    try:
        from email.utils import parsedate_to_datetime
        from datetime import datetime, timezone

        retry_date = parsedate_to_datetime(value)

        if retry_date.tzinfo is None:
            retry_date = retry_date.replace(tzinfo=timezone.utc)

        seconds = (
            retry_date - datetime.now(timezone.utc)
        ).total_seconds()

        return max(0.0, seconds)

    except Exception:
        return None


def calculate_backoff(attempt):
    """
    Экспоненциальная задержка + случайный jitter.

    Примерно:
        attempt 0 -> ~1 сек
        attempt 1 -> ~2 сек
        attempt 2 -> ~4 сек
        attempt 3 -> ~8 сек
        ...
    """

    base = min(
        MAX_BACKOFF,
        2 ** attempt
    )

    # Добавляем 0-25% jitter, чтобы несколько потоков
    # не проснулись одновременно.
    return base + random.uniform(0, base * 0.25)


def fetch_json(session, url):
    """
    Выполняет GET с контролируемыми retry.

    В отличие от urllib3.Retry здесь мы полностью контролируем
    повторные запросы.
    """

    last_error = None

    for attempt in range(MAX_RETRIES + 1):

        # Глобальный cooldown после 429/503.
        wait_for_cooldown()

        # Глобальный rate limit.
        wait_for_rate_limit()

        try:
            response = session.get(
                url,
                timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
            )

        except requests.RequestException as exc:
            last_error = exc

            if attempt >= MAX_RETRIES:
                raise

            delay = calculate_backoff(attempt)

            time.sleep(delay)
            continue

        # Успешный ответ.
        if response.ok:
            try:
                return response.json()
            except ValueError as exc:
                last_error = exc

                if attempt >= MAX_RETRIES:
                    raise RuntimeError(
                        "API вернул некорректный JSON"
                    ) from exc

                time.sleep(calculate_backoff(attempt))
                continue

        status = response.status_code

        # Ошибка, которую имеет смысл повторить.
        if status in RETRY_STATUS_CODES:

            retry_after = parse_retry_after(response)

            if retry_after is not None:
                delay = min(
                    max(retry_after, 0.0),
                    MAX_BACKOFF,
                )
            else:
                delay = calculate_backoff(attempt)

            # Особенно важно для 429.
            if status == 429:
                # Притормаживаем весь процесс.
                set_global_cooldown(delay)

            elif status in {502, 503, 504}:
                # Небольшой глобальный cooldown тоже полезен
                # при временной перегрузке сервера.
                set_global_cooldown(
                    min(delay, 5.0)
                )

            last_error = RuntimeError(
                f"HTTP {status}: {response.text[:300]}"
            )

            if attempt >= MAX_RETRIES:
                raise last_error

            time.sleep(delay)
            continue

        # Остальные HTTP ошибки повторять бессмысленно.
        try:
            response.raise_for_status()
        except requests.HTTPError:
            raise

    if last_error:
        raise last_error

    raise RuntimeError("Неизвестная ошибка HTTP")


# ============================================================
# FILES
# ============================================================

def save(path, obj):
    """
    Атомарно сохраняет JSON.

    Сначала создаётся .tmp файл, затем он заменяет основной.

    Это защищает от ситуации, когда процесс был прерван
    во время записи JSON.
    """

    path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = path.with_suffix(
        path.suffix + ".tmp"
    )

    data = json.dumps(
        obj,
        ensure_ascii=False,
        separators=(",", ":"),
    )

    temp_path.write_text(
        data,
        encoding="utf-8",
    )

    temp_path.replace(path)


# ============================================================
# DATES
# ============================================================

def get_months(count):
    today = date.today()

    month = today.month
    year = today.year

    result = []

    for _ in range(count):
        result.append((month, year))

        month += 1

        if month > 12:
            month = 1
            year += 1

    return result


# ============================================================
# CATALOGS
# ============================================================

def download_catalog(url, label):
    try:
        return fetch_json(
            get_session(),
            url,
        )

    except Exception as exc:
        print(
            f"Критическая ошибка: "
            f"не удалось скачать каталог {label}: {exc}"
        )

        sys.exit(1)


# ============================================================
# SCHEDULE
# ============================================================

def fetch_schedule(
    kind,
    base_url,
    token,
    item_id,
    month,
    year,
):
    """
    Загружает одно расписание и сохраняет его
    в том же месте и формате, что и старый скрипт.
    """

    if kind == "student":
        param = "group_id"
        out_dir = "s"
    else:
        param = "staff_id"
        out_dir = "t"

    url = (
        f"{base_url}"
        f"?token={token}"
        f"&{param}={item_id}"
        f"&month={month}"
        f"&year={year}"
    )

    response = fetch_json(
        get_session(),
        url,
    )

    if "data" not in response:
        raise RuntimeError(
            "API не вернул поле data"
        )

    save(
        OUT_DIR
        / out_dir
        / item_id
        / f"{month}_{year}.json",
        response["data"],
    )


# ============================================================
# TASK ITERATOR
# ============================================================

def generate_tasks(
    months,
    group_ids,
    staff_ids,
):
    """
    Генерирует задачи лениво.

    Старый вариант создавал огромный список schedule_tasks.
    Здесь задачи появляются по мере необходимости.
    """

    for month, year in months:

        for group_id in group_ids:
            yield (
                "student",
                API_STU,
                TOKEN_STU,
                group_id,
                month,
                year,
            )

        for staff_id in staff_ids:
            yield (
                "teacher",
                API_TCH,
                TOKEN_TCH,
                staff_id,
                month,
                year,
            )


# ============================================================
# MAIN DOWNLOAD LOOP
# ============================================================

def download_schedules(
    months,
    group_ids,
    staff_ids,
):
    """
    Загружает расписания ограниченным числом workers.

    Вместо создания future для ВСЕХ задач одновременно
    держим только небольшую очередь.

    Это снижает расход памяти и делает поведение
    намного более предсказуемым.
    """

    total_stu = len(group_ids) * len(months)
    total_tch = len(staff_ids) * len(months)
    total_tasks = total_stu + total_tch

    print(
        f"📅 Загрузка расписаний: "
        f"{total_tasks} запросов"
    )

    print(
        f"   Потоки: {WORKERS}"
    )

    print(
        f"   Лимит: "
        f"{REQUESTS_PER_SECOND:g} запросов/сек"
    )

    print(
        f"   Retry: {MAX_RETRIES}"
    )

    print()

    errors = 0
    done = 0

    task_iterator = generate_tasks(
        months,
        group_ids,
        staff_ids,
    )

    with ThreadPoolExecutor(
        max_workers=WORKERS
    ) as pool:

        # Держим ограниченное количество future.
        pending = {}

        def submit_next():
            try:
                task = next(task_iterator)
            except StopIteration:
                return False

            future = pool.submit(
                fetch_schedule,
                *task,
            )

            pending[future] = task

            return True

        # Первичная очередь.
        for _ in range(WORKERS * 2):
            if not submit_next():
                break

        while pending:

            # Ждём завершения хотя бы одной задачи.
            completed = next(
                as_completed(pending)
            )

            task = pending.pop(completed)

            done += 1

            try:
                completed.result()

            except Exception as exc:
                errors += 1

                kind, _, _, item_id, month, year = task

                subject = (
                    "группа"
                    if kind == "student"
                    else "преподаватель"
                )

                with _print_lock:
                    print(
                        f"   ⚠ {subject} {item_id} "
                        f"{month}_{year}: {exc}"
                    )

            # Поддерживаем небольшую очередь.
            submit_next()

            if done % 50 == 0 or done == total_tasks:
                with _print_lock:
                    print(
                        f"   ... {done}/{total_tasks} "
                        f"(ошибок: {errors})"
                    )

    return errors, total_stu, total_tch


# ============================================================
# MAIN
# ============================================================

def main():

    if not TOKEN_STU or not TOKEN_TCH:
        print(
            "Ошибка: укажите TOKEN_STUDENTS и "
            "TOKEN_TEACHERS в .env или переменных окружения"
        )

        sys.exit(1)

    # --------------------------------------------------------
    # API CHECK
    # --------------------------------------------------------

    print("🔗 Проверка доступности API...")

    try:
        wait_for_rate_limit()

        response = get_session().get(
            f"{API_STU}?token={TOKEN_STU}",
            timeout=(CONNECT_TIMEOUT, 10),
        )

        response.raise_for_status()

        print("   API доступен")

    except Exception as exc:
        print(f"❌ API недоступен: {exc}")
        print(
            "   Завершение. "
            "Используйте локальные данные из data/"
        )

        sys.exit(1)

    # --------------------------------------------------------
    # MONTHS
    # --------------------------------------------------------

    months = get_months(MONTHS_AHEAD)

    print(
        "📆 Месяцы: "
        + ", ".join(
            f"{month:02d}.{year}"
            for month, year in months
        )
    )

    # --------------------------------------------------------
    # CATALOGS
    # --------------------------------------------------------

    print()
    print("📚 Загрузка каталога групп...")
    print("👨‍🏫 Загрузка каталога преподавателей...")

    with ThreadPoolExecutor(max_workers=2) as pool:

        stu_future = pool.submit(
            download_catalog,
            f"{API_STU}?token={TOKEN_STU}",
            "студентов",
        )

        tch_future = pool.submit(
            download_catalog,
            f"{API_TCH}?token={TOKEN_TCH}",
            "преподавателей",
        )

        stu_resp = stu_future.result()
        tch_resp = tch_future.result()

    # --------------------------------------------------------
    # STUDENTS
    # --------------------------------------------------------

    groups_data = stu_resp["data"]["groups"]

    save(
        OUT_DIR / "students.json",
        groups_data,
    )

    group_ids = []

    for _, department in groups_data.items():

        if not department.get("items"):
            continue

        for _, course in department["items"].items():

            if not course.get("items"):
                continue

            for _, group in course["items"].items():

                group_id = group.get("id")

                if group_id is not None:
                    group_ids.append(
                        str(group_id)
                    )

    # Убираем возможные дубликаты,
    # сохраняя исходный порядок.
    group_ids = list(dict.fromkeys(group_ids))

    print(
        f"   Найдено {len(group_ids)} групп"
    )

    # --------------------------------------------------------
    # TEACHERS
    # --------------------------------------------------------

    tch_data = tch_resp["data"]

    save(
        OUT_DIR / "teachers.json",
        {
            "departments": tch_data["departments"],
            "staff": tch_data["staff"],
        },
    )

    staff_ids = []

    for _, members in tch_data["staff"].items():

        for staff_id in members:
            staff_ids.append(
                str(staff_id)
            )

    staff_ids = list(dict.fromkeys(staff_ids))

    print(
        f"   Найдено {len(staff_ids)} преподавателей"
    )

    # --------------------------------------------------------
    # SCHEDULES
    # --------------------------------------------------------

    errors, total_stu, total_tch = (
        download_schedules(
            months,
            group_ids,
            staff_ids,
        )
    )

    # --------------------------------------------------------
    # META
    # --------------------------------------------------------

    save(
        OUT_DIR / "meta.json",
        {
            "generated": date.today().isoformat(),
            "months": [
                {
                    "month": month,
                    "year": year,
                }
                for month, year in months
            ],
            "groups_count": len(group_ids),
            "staff_count": len(staff_ids),
            "errors": errors,
        },
    )

    # --------------------------------------------------------
    # RESULT
    # --------------------------------------------------------

    print()
    print(
        f"✅ Готово! Данные сохранены в {OUT_DIR}/"
    )

    if errors:
        print(
            f"⚠ Ошибок: {errors}"
        )

    print(
        f"   Студенческих расписаний: {total_stu}"
    )

    print(
        f"   Преподавательских расписаний: {total_tch}"
    )


if __name__ == "__main__":
    main()
