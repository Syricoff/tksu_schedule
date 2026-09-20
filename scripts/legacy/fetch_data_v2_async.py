#!/usr/bin/env python3
"""
Асинхронная предварительная загрузка расписания с API APEKS.

Особенности:
- asyncio + aiohttp;
- ограничение количества одновременных запросов;
- глобальный rate limit;
- адаптивное снижение/повышение скорости;
- обработка HTTP 429/5xx/timeout;
- уважение Retry-After;
- экспоненциальный backoff + jitter;
- ограниченная очередь задач;
- повторное использование HTTP-соединений;
- пропуск уже актуальных файлов;
- атомарная запись JSON;
- подробная статистика производительности;
- выходной формат совместим со старым скриптом.

Зависимость:
    pip install aiohttp python-dotenv

Запуск:
    python scripts/fetch_data.py

Переменные окружения:
    TOKEN_STUDENTS=...
    TOKEN_TEACHERS=...

    MONTHS_AHEAD=4

    WORKERS=12
    REQUESTS_PER_SECOND=10

    MAX_RETRIES=5
    MAX_BACKOFF=30

    # 0 = скачивать все файлы заново.
    # >0 = существующий файл младше N часов не скачивать.
    CACHE_HOURS=24

    # Адаптивный режим:
    # true  = скорость автоматически меняется по ответам API.
    # false = используется фиксированный REQUESTS_PER_SECOND.
    ADAPTIVE_RATE_LIMIT=true

    # Начальная скорость адаптивного limiter.
    INITIAL_REQUESTS_PER_SECOND=8

    # Нижняя/верхняя границы адаптивного limiter.
    MIN_REQUESTS_PER_SECOND=2
    MAX_REQUESTS_PER_SECOND=20
"""

import asyncio
import json
import os
import random
import sys
import time
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

import aiohttp

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

MONTHS_AHEAD = max(
    1,
    int(os.environ.get("MONTHS_AHEAD", "4")),
)

WORKERS = max(
    1,
    int(os.environ.get("WORKERS", "12")),
)

REQUESTS_PER_SECOND = max(
    0.1,
    float(os.environ.get("REQUESTS_PER_SECOND", "10")),
)

INITIAL_REQUESTS_PER_SECOND = max(
    0.1,
    float(
        os.environ.get(
            "INITIAL_REQUESTS_PER_SECOND",
            str(REQUESTS_PER_SECOND),
        )
    ),
)

MIN_REQUESTS_PER_SECOND = max(
    0.1,
    float(os.environ.get("MIN_REQUESTS_PER_SECOND", "2")),
)

MAX_REQUESTS_PER_SECOND = max(
    MIN_REQUESTS_PER_SECOND,
    float(os.environ.get("MAX_REQUESTS_PER_SECOND", "20")),
)

ADAPTIVE_RATE_LIMIT = os.environ.get(
    "ADAPTIVE_RATE_LIMIT",
    "true",
).lower() in {"1", "true", "yes", "on"}

MAX_RETRIES = max(
    0,
    int(os.environ.get("MAX_RETRIES", "5")),
)

MAX_BACKOFF = max(
    1.0,
    float(os.environ.get("MAX_BACKOFF", "30")),
)

CONNECT_TIMEOUT = max(
    1.0,
    float(os.environ.get("CONNECT_TIMEOUT", "10")),
)

READ_TIMEOUT = max(
    1.0,
    float(os.environ.get("READ_TIMEOUT", "60")),
)

CACHE_HOURS = max(
    0.0,
    float(os.environ.get("CACHE_HOURS", "24")),
)

# При CACHE_HOURS=0 кэш отключён.
# При CACHE_HOURS>0 существующий свежий файл пропускается.


# ============================================================
# STATISTICS
# ============================================================


class Statistics:
    def __init__(self):
        self.started = time.monotonic()

        self.total_tasks = 0
        self.completed_tasks = 0
        self.downloaded_tasks = 0
        self.skipped_tasks = 0
        self.failed_tasks = 0

        self.http_requests = 0
        self.successful_http = 0

        self.statuses = Counter()
        self.retry_count = 0
        self.rate_limit_hits = 0
        self.server_errors = 0
        self.timeouts = 0

        self.response_times = []

        self._lock = asyncio.Lock()

    async def request_started(self):
        async with self._lock:
            self.http_requests += 1

    async def request_finished(
        self,
        status: int,
        elapsed: float,
    ):
        async with self._lock:
            self.statuses[status] += 1
            self.response_times.append(elapsed)

            if 200 <= status < 300:
                self.successful_http += 1

            if status == 429:
                self.rate_limit_hits += 1

            if 500 <= status <= 599:
                self.server_errors += 1

    async def retry(self):
        async with self._lock:
            self.retry_count += 1

    async def timeout(self):
        async with self._lock:
            self.timeouts += 1

    async def task_done(
        self,
        downloaded: bool,
    ):
        async with self._lock:
            self.completed_tasks += 1

            if downloaded:
                self.downloaded_tasks += 1
            else:
                self.skipped_tasks += 1

    async def task_failed(self):
        async with self._lock:
            self.completed_tasks += 1
            self.failed_tasks += 1

    async def snapshot(self):
        async with self._lock:
            elapsed = max(
                time.monotonic() - self.started,
                0.001,
            )

            avg_response = (
                sum(self.response_times) / len(self.response_times)
                if self.response_times
                else 0.0
            )

            return {
                "total_tasks": self.total_tasks,
                "completed_tasks": self.completed_tasks,
                "downloaded_tasks": self.downloaded_tasks,
                "skipped_tasks": self.skipped_tasks,
                "failed_tasks": self.failed_tasks,
                "http_requests": self.http_requests,
                "successful_http": self.successful_http,
                "retry_count": self.retry_count,
                "rate_limit_hits": self.rate_limit_hits,
                "server_errors": self.server_errors,
                "timeouts": self.timeouts,
                "elapsed": elapsed,
                "actual_rps": self.successful_http / elapsed,
                "avg_response": avg_response,
                "statuses": dict(self.statuses),
            }


STATS = Statistics()


# ============================================================
# ADAPTIVE RATE LIMITER
# ============================================================


class AdaptiveRateLimiter:
    """
    Глобальный limiter.

    Он ограничивает именно начало HTTP-запросов, а не число
    одновременно выполняющихся запросов.

    В adaptive режиме:
    - успешная серия запросов постепенно увеличивает скорость;
    - 429/5xx резко уменьшают скорость;
    - Retry-After дополнительно ставит глобальный cooldown.
    """

    def __init__(
        self,
        initial_rps: float,
        min_rps: float,
        max_rps: float,
        adaptive: bool,
    ):
        self.rps = min(
            max(initial_rps, min_rps),
            max_rps,
        )

        self.min_rps = min_rps
        self.max_rps = max_rps
        self.adaptive = adaptive

        self.next_time = 0.0
        self.cooldown_until = 0.0

        self._lock = asyncio.Lock()

        self.success_streak = 0

    async def acquire(self):
        while True:
            async with self._lock:
                now = time.monotonic()

                cooldown_wait = self.cooldown_until - now

                if cooldown_wait > 0:
                    wait = cooldown_wait
                else:
                    interval = 1.0 / self.rps

                    if now >= self.next_time:
                        self.next_time = now + interval
                        return

                    wait = self.next_time - now

            await asyncio.sleep(wait)

    async def cooldown(self, seconds: float):
        if seconds <= 0:
            return

        async with self._lock:
            until = time.monotonic() + seconds

            if until > self.cooldown_until:
                self.cooldown_until = until

    async def success(self):
        if not self.adaptive:
            return

        async with self._lock:
            self.success_streak += 1

            # Медленное увеличение скорости.
            # Увеличиваем только после серии успешных запросов.
            if self.success_streak >= 25:
                self.rps = min(
                    self.max_rps,
                    self.rps * 1.10,
                )
                self.success_streak = 0

    async def failure(self):
        if not self.adaptive:
            return

        async with self._lock:
            self.success_streak = 0

            # Резкое снижение при проблемах API.
            self.rps = max(
                self.min_rps,
                self.rps * 0.60,
            )

    async def current_rps(self):
        async with self._lock:
            return self.rps


RATE_LIMITER = AdaptiveRateLimiter(
    initial_rps=INITIAL_REQUESTS_PER_SECOND,
    min_rps=MIN_REQUESTS_PER_SECOND,
    max_rps=MAX_REQUESTS_PER_SECOND,
    adaptive=ADAPTIVE_RATE_LIMIT,
)


# ============================================================
# HTTP HELPERS
# ============================================================

RETRYABLE_STATUSES = {
    408,
    429,
    500,
    502,
    503,
    504,
}


def parse_retry_after(
    response: aiohttp.ClientResponse,
) -> Optional[float]:
    value = response.headers.get("Retry-After")

    if not value:
        return None

    try:
        seconds = float(value)

        if seconds >= 0:
            return seconds
    except (TypeError, ValueError):
        pass

    try:
        from email.utils import parsedate_to_datetime

        retry_date = parsedate_to_datetime(value)

        if retry_date.tzinfo is None:
            retry_date = retry_date.replace(tzinfo=timezone.utc)

        seconds = (retry_date - datetime.now(timezone.utc)).total_seconds()

        return max(0.0, seconds)

    except Exception:
        return None


def calculate_backoff(attempt: int) -> float:
    base = min(
        MAX_BACKOFF,
        2**attempt,
    )

    return base + random.uniform(
        0,
        base * 0.25,
    )


async def fetch_json(
    session: aiohttp.ClientSession,
    url: str,
):
    last_error = None

    for attempt in range(MAX_RETRIES + 1):
        await RATE_LIMITER.acquire()

        started = time.monotonic()

        try:
            await STATS.request_started()

            async with session.get(
                url,
                timeout=aiohttp.ClientTimeout(
                    total=READ_TIMEOUT,
                    connect=CONNECT_TIMEOUT,
                ),
            ) as response:
                elapsed = time.monotonic() - started

                await STATS.request_finished(
                    response.status,
                    elapsed,
                )

                if 200 <= response.status < 300:
                    try:
                        data = await response.json(content_type=None)

                        await RATE_LIMITER.success()

                        return data

                    except (ValueError, aiohttp.ContentTypeError) as exc:
                        last_error = RuntimeError("API вернул некорректный JSON")

                        await RATE_LIMITER.failure()

                        if attempt >= MAX_RETRIES:
                            raise last_error from exc

                        delay = calculate_backoff(attempt)

                        await STATS.retry()
                        await asyncio.sleep(delay)

                        continue

                status = response.status

                if status in RETRYABLE_STATUSES:
                    retry_after = parse_retry_after(response)

                    if retry_after is not None:
                        delay = min(
                            retry_after,
                            MAX_BACKOFF,
                        )
                    else:
                        delay = calculate_backoff(attempt)

                    await RATE_LIMITER.failure()
                    await RATE_LIMITER.cooldown(delay)

                    last_error = RuntimeError(f"HTTP {status}")

                    if attempt >= MAX_RETRIES:
                        try:
                            body = await response.text()
                        except Exception:
                            body = ""

                        raise RuntimeError(f"HTTP {status}: {body[:300]}")

                    await STATS.retry()

                    # Небольшой jitter дополнительно
                    # разводит повторные запросы.
                    await asyncio.sleep(
                        random.uniform(
                            0,
                            min(delay * 0.25, 1.0),
                        )
                    )

                    continue

                try:
                    body = await response.text()
                except Exception:
                    body = ""

                raise RuntimeError(f"HTTP {status}: {body[:300]}")

        except asyncio.TimeoutError as exc:
            await STATS.timeout()
            await RATE_LIMITER.failure()

            last_error = exc

            if attempt >= MAX_RETRIES:
                raise

            delay = calculate_backoff(attempt)

            await STATS.retry()
            await asyncio.sleep(delay)

        except aiohttp.ClientError as exc:
            last_error = exc
            await RATE_LIMITER.failure()

            if attempt >= MAX_RETRIES:
                raise

            delay = calculate_backoff(attempt)

            await STATS.retry()
            await asyncio.sleep(delay)

    if last_error:
        raise last_error

    raise RuntimeError("Неизвестная ошибка HTTP")


# ============================================================
# FILES
# ============================================================


def save_json(
    path: Path,
    obj,
):
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_path = path.with_suffix(path.suffix + ".tmp")

    temp_path.write_text(
        json.dumps(
            obj,
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    temp_path.replace(path)


def is_cache_valid(path: Path) -> bool:
    if CACHE_HOURS <= 0:
        return False

    if not path.exists():
        return False

    age_seconds = time.time() - path.stat().st_mtime

    return age_seconds < CACHE_HOURS * 3600


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


async def download_catalog(
    session,
    url,
    label,
):
    try:
        return await fetch_json(
            session,
            url,
        )

    except Exception as exc:
        print(f"Критическая ошибка: не удалось скачать каталог {label}: {exc}")

        raise


# ============================================================
# TASKS
# ============================================================


def generate_tasks(
    months,
    group_ids,
    staff_ids,
):
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


def task_path(
    kind: str,
    item_id: str,
    month: int,
    year: int,
) -> Path:
    out_dir = "s" if kind == "student" else "t"

    return OUT_DIR / out_dir / item_id / f"{month}_{year}.json"


async def fetch_schedule(
    session,
    kind,
    base_url,
    token,
    item_id,
    month,
    year,
):
    if kind == "student":
        param = "group_id"
    else:
        param = "staff_id"

    path = task_path(
        kind,
        item_id,
        month,
        year,
    )

    # Кэш.
    if is_cache_valid(path):
        return False

    url = f"{base_url}?token={token}&{param}={item_id}&month={month}&year={year}"

    response = await fetch_json(
        session,
        url,
    )

    if "data" not in response:
        raise RuntimeError("API не вернул поле data")

    save_json(
        path,
        response["data"],
    )

    return True


# ============================================================
# WORKERS
# ============================================================


async def worker(
    worker_id: int,
    queue: asyncio.Queue,
    session,
):
    while True:
        task = await queue.get()

        if task is None:
            queue.task_done()
            return

        try:
            downloaded = await fetch_schedule(
                session,
                *task,
            )

            await STATS.task_done(downloaded=downloaded)

        except Exception as exc:
            kind, _, _, item_id, month, year = task

            subject = "группа" if kind == "student" else "преподаватель"

            print(f"   ⚠ {subject} {item_id} {month}_{year}: {exc}")

            await STATS.task_failed()

        finally:
            queue.task_done()


# ============================================================
# PROGRESS
# ============================================================


async def progress_reporter():
    last_completed = -1

    while True:
        await asyncio.sleep(5)

        snapshot = await STATS.snapshot()
        rps = await RATE_LIMITER.current_rps()

        completed = snapshot["completed_tasks"]

        if completed == last_completed:
            continue

        last_completed = completed

        print(
            f"   [{completed}/"
            f"{snapshot['total_tasks']}] "
            f"HTTP={snapshot['http_requests']} "
            f"ok={snapshot['successful_http']} "
            f"skip={snapshot['skipped_tasks']} "
            f"err={snapshot['failed_tasks']} "
            f"429={snapshot['rate_limit_hits']} "
            f"5xx={snapshot['server_errors']} "
            f"RPS={rps:.2f}"
        )


# ============================================================
# DOWNLOAD SCHEDULES
# ============================================================


async def download_schedules(
    session,
    months,
    group_ids,
    staff_ids,
):
    total_stu = len(group_ids) * len(months)

    total_tch = len(staff_ids) * len(months)

    total_tasks = total_stu + total_tch

    STATS.total_tasks = total_tasks

    print()
    print(f"📅 Потенциальных расписаний: {total_tasks}")

    print(f"   Группы: {len(group_ids)} × {len(months)} = {total_stu}")

    print(f"   Преподаватели: {len(staff_ids)} × {len(months)} = {total_tch}")

    print(f"   Async workers: {WORKERS}")

    print(f"   Начальный лимит: {INITIAL_REQUESTS_PER_SECOND:g} req/s")

    print(
        f"   Диапазон adaptive limiter: "
        f"{MIN_REQUESTS_PER_SECOND:g}–"
        f"{MAX_REQUESTS_PER_SECOND:g} req/s"
    )

    print(f"   Адаптивный режим: {'да' if ADAPTIVE_RATE_LIMIT else 'нет'}")

    if CACHE_HOURS > 0:
        print(f"   Кэш: {CACHE_HOURS:g} ч")
    else:
        print("   Кэш: отключён")

    queue = asyncio.Queue(maxsize=WORKERS * 2)

    workers = [
        asyncio.create_task(
            worker(
                i + 1,
                queue,
                session,
            )
        )
        for i in range(WORKERS)
    ]

    reporter = asyncio.create_task(progress_reporter())

    for task in generate_tasks(
        months,
        group_ids,
        staff_ids,
    ):
        await queue.put(task)

    await queue.join()

    for _ in workers:
        await queue.put(None)

    await asyncio.gather(*workers)

    reporter.cancel()

    try:
        await reporter
    except asyncio.CancelledError:
        pass

    snapshot = await STATS.snapshot()

    return (
        snapshot,
        total_stu,
        total_tch,
    )


# ============================================================
# MAIN
# ============================================================


async def main():
    if not TOKEN_STU or not TOKEN_TCH:
        print(
            "Ошибка: укажите TOKEN_STUDENTS и "
            "TOKEN_TEACHERS в .env или переменных окружения"
        )
        return 1

    connector = aiohttp.TCPConnector(
        limit=WORKERS,
        limit_per_host=WORKERS,
        ttl_dns_cache=300,
        enable_cleanup_closed=True,
    )

    timeout = aiohttp.ClientTimeout(
        total=READ_TIMEOUT,
        connect=CONNECT_TIMEOUT,
    )

    headers = {
        "User-Agent": "TksuScheduleBot/3.0",
        "Accept": "application/json",
    }

    async with aiohttp.ClientSession(
        connector=connector,
        timeout=timeout,
        headers=headers,
    ) as session:
        # ----------------------------------------------------
        # API CHECK
        # ----------------------------------------------------

        print("🔗 Проверка доступности API...")

        try:
            response = await fetch_json(
                session,
                f"{API_STU}?token={TOKEN_STU}",
            )

            if "data" not in response:
                raise RuntimeError("API вернул неожиданный ответ")

            print("   API доступен")

        except Exception as exc:
            print(f"❌ API недоступен: {exc}")

            print("   Завершение. Используйте локальные данные из data/")

            return 1

        # ----------------------------------------------------
        # MONTHS
        # ----------------------------------------------------

        months = get_months(MONTHS_AHEAD)

        print(
            "📆 Месяцы: " + ", ".join(f"{month:02d}.{year}" for month, year in months)
        )

        # ----------------------------------------------------
        # CATALOGS
        # ----------------------------------------------------

        print()
        print("📚 Загрузка каталога групп...")

        print("👨‍🏫 Загрузка каталога преподавателей...")

        stu_task = asyncio.create_task(
            download_catalog(
                session,
                f"{API_STU}?token={TOKEN_STU}",
                "студентов",
            )
        )

        tch_task = asyncio.create_task(
            download_catalog(
                session,
                f"{API_TCH}?token={TOKEN_TCH}",
                "преподавателей",
            )
        )

        stu_resp, tch_resp = await asyncio.gather(
            stu_task,
            tch_task,
        )

        # ----------------------------------------------------
        # STUDENTS
        # ----------------------------------------------------

        groups_data = stu_resp["data"]["groups"]

        save_json(
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
                        group_ids.append(str(group_id))

        group_ids = list(dict.fromkeys(group_ids))

        print(f"   Найдено {len(group_ids)} групп")

        # ----------------------------------------------------
        # TEACHERS
        # ----------------------------------------------------

        tch_data = tch_resp["data"]

        save_json(
            OUT_DIR / "teachers.json",
            {
                "departments": tch_data["departments"],
                "staff": tch_data["staff"],
            },
        )

        staff_ids = []

        for _, members in tch_data["staff"].items():
            for staff_id in members:
                staff_ids.append(str(staff_id))

        staff_ids = list(dict.fromkeys(staff_ids))

        print(f"   Найдено {len(staff_ids)} преподавателей")

        # ----------------------------------------------------
        # SCHEDULES
        # ----------------------------------------------------

        (
            snapshot,
            total_stu,
            total_tch,
        ) = await download_schedules(
            session,
            months,
            group_ids,
            staff_ids,
        )

        # ----------------------------------------------------
        # META
        # ----------------------------------------------------

        save_json(
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
                "errors": snapshot["failed_tasks"],
            },
        )

        # ----------------------------------------------------
        # RESULT
        # ----------------------------------------------------

        elapsed = snapshot["elapsed"]

        print()
        print("════════════════════════════════════")
        print("✅ Загрузка завершена")
        print("════════════════════════════════════")

        print(f"Время: {elapsed:.1f} сек ({elapsed / 60:.1f} мин)")

        print(f"Задач: {snapshot['total_tasks']}")

        print(f"Скачано: {snapshot['downloaded_tasks']}")

        print(f"Пропущено по кэшу: {snapshot['skipped_tasks']}")

        print(f"Ошибок: {snapshot['failed_tasks']}")

        print()

        print(f"HTTP-запросов: {snapshot['http_requests']}")

        print(f"Успешных HTTP: {snapshot['successful_http']}")

        print(f"Retry: {snapshot['retry_count']}")

        print(f"429: {snapshot['rate_limit_hits']}")

        print(f"5xx: {snapshot['server_errors']}")

        print(f"Timeout: {snapshot['timeouts']}")

        print()

        print(f"Фактическая скорость успешных HTTP: {snapshot['actual_rps']:.2f} req/s")

        print(f"Среднее время ответа API: {snapshot['avg_response']:.3f} сек")

        print(f"Финальный лимит: {await RATE_LIMITER.current_rps():.2f} req/s")

        print()

        print(f"Студенческих расписаний: {total_stu}")

        print(f"Преподавательских расписаний: {total_tch}")

        print(f"Данные сохранены в {OUT_DIR}/")

        print()

        if snapshot["statuses"]:
            print("HTTP-коды:")

            for status, count in sorted(snapshot["statuses"].items()):
                print(f"   {status}: {count}")

    return 0


if __name__ == "__main__":
    try:
        exit_code = asyncio.run(main())
    except KeyboardInterrupt:
        print("\n⛔ Остановлено пользователем")
        exit_code = 130

    sys.exit(exit_code)
