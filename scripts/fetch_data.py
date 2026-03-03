#!/usr/bin/env python3
"""
Скрипт предварительной загрузки расписания с API APEKS.
Запускается при сборке (GitHub Actions) или локально.
Токены берутся из переменных окружения или .env.

Использование:
    python scripts/fetch_data.py          # из .env / окружения
    TOKEN_STUDENTS=... TOKEN_TEACHERS=... python scripts/fetch_data.py
"""

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import ssl

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

API_STU = "https://apeks.tksu.ru/api/call/schedule-schedule/student"
API_TCH = "https://apeks.tksu.ru/api/call/schedule-schedule/staff"

TOKEN_STU = os.environ.get("TOKEN_STUDENTS", "")
TOKEN_TCH = os.environ.get("TOKEN_TEACHERS", "")

OUT_DIR = Path(os.environ.get("DATA_DIR", "data"))
MONTHS_AHEAD = int(os.environ.get("MONTHS_AHEAD", "4"))
WORKERS = int(os.environ.get("WORKERS", "3"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "4"))
REQUEST_DELAY = float(os.environ.get("REQUEST_DELAY", "0.3"))

_print_lock = Lock()
_ssl_ctx = ssl.create_default_context()


def fetch_json(url, retries=MAX_RETRIES):
    for attempt in range(1, retries + 1):
        try:
            req = Request(url, headers={"User-Agent": "TksuScheduleBot/1.0"})
            with urlopen(req, timeout=30, context=_ssl_ctx) as resp:
                return json.loads(resp.read())
        except (HTTPError, URLError, OSError, ConnectionError, TimeoutError) as e:
            if attempt == retries:
                raise
            wait = min(2 ** attempt, 30) + (attempt * 0.5)
            with _print_lock:
                print(f"   ↻ повтор {attempt}/{retries} через {wait:.0f}с: {e}")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def save(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def get_months(count):
    today = date.today()
    m, y = today.month, today.year
    result = []
    for _ in range(count):
        result.append((m, y))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return result


def main():
    if not TOKEN_STU or not TOKEN_TCH:
        print("Ошибка: укажите TOKEN_STUDENTS и TOKEN_TEACHERS в .env или переменных окружения")
        sys.exit(1)

    months = get_months(MONTHS_AHEAD)
    errors = 0

    # ═══ Студенты: каталог ═══
    print("📚 Загрузка каталога групп...")
    try:
        stu_resp = fetch_json(f"{API_STU}?token={TOKEN_STU}")
    except (HTTPError, URLError) as e:
        print(f"Критическая ошибка: не удалось скачать каталог студентов: {e}")
        sys.exit(1)

    groups_data = stu_resp["data"]["groups"]
    save(OUT_DIR / "students.json", groups_data)

    # Собираем все group_id
    group_ids = []
    for dk, dept in groups_data.items():
        if not dept.get("items"):
            continue
        for ck, course in dept["items"].items():
            if not course.get("items"):
                continue
            for gk, g in course["items"].items():
                group_ids.append(str(g["id"]))

    print(f"   Найдено {len(group_ids)} групп")

    # ═══ Студенты: расписания ═══
    stu_tasks = []
    for m, y in months:
        for gid in group_ids:
            stu_tasks.append((gid, m, y))

    total_stu = len(stu_tasks)
    print(f"📅 Загрузка расписаний студентов: {total_stu} запросов ({WORKERS} потоков)...")
    done = 0

    def fetch_student(args):
        gid, m, y = args
        time.sleep(REQUEST_DELAY)
        url = f"{API_STU}?token={TOKEN_STU}&group_id={quote(gid)}&month={m}&year={y}"
        resp = fetch_json(url)
        save(OUT_DIR / "s" / gid / f"{m}_{y}.json", resp["data"])

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_student, t): t for t in stu_tasks}
        for fut in as_completed(futures):
            done += 1
            t = futures[fut]
            try:
                fut.result()
            except Exception as e:
                errors += 1
                with _print_lock:
                    print(f"   ⚠ группа {t[0]}: {e}")
            if done % 100 == 0:
                with _print_lock:
                    print(f"   ... {done}/{total_stu}")

    # ═══ Преподаватели: каталог ═══
    print("👨‍🏫 Загрузка каталога преподавателей...")
    try:
        tch_resp = fetch_json(f"{API_TCH}?token={TOKEN_TCH}")
    except (HTTPError, URLError) as e:
        print(f"Критическая ошибка: не удалось скачать каталог преподавателей: {e}")
        sys.exit(1)

    tch_data = tch_resp["data"]
    save(OUT_DIR / "teachers.json", {
        "departments": tch_data["departments"],
        "staff": tch_data["staff"]
    })

    # Собираем все staff_id
    staff_ids = []
    for dept_id, members in tch_data["staff"].items():
        for sid in members:
            staff_ids.append(str(sid))

    print(f"   Найдено {len(staff_ids)} преподавателей")

    # ═══ Преподаватели: расписания ═══
    tch_tasks = []
    for m, y in months:
        for sid in staff_ids:
            tch_tasks.append((sid, m, y))

    total_tch = len(tch_tasks)
    print(f"📅 Загрузка расписаний преподавателей: {total_tch} запросов ({WORKERS} потоков)...")
    done = 0

    def fetch_teacher(args):
        sid, m, y = args
        time.sleep(REQUEST_DELAY)
        url = f"{API_TCH}?token={TOKEN_TCH}&staff_id={quote(sid)}&month={m}&year={y}"
        resp = fetch_json(url)
        save(OUT_DIR / "t" / sid / f"{m}_{y}.json", resp["data"])

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_teacher, t): t for t in tch_tasks}
        for fut in as_completed(futures):
            done += 1
            t = futures[fut]
            try:
                fut.result()
            except Exception as e:
                errors += 1
                with _print_lock:
                    print(f"   ⚠ преподаватель {t[0]}: {e}")
            if done % 100 == 0:
                with _print_lock:
                    print(f"   ... {done}/{total_tch}")

    print(f"\n✅ Готово! Данные сохранены в {OUT_DIR}/")
    if errors:
        print(f"⚠ Ошибок: {errors}")
    print(f"   Студенческих расписаний: {total_stu - errors}")
    print(f"   Преподавательских расписаний: {total_tch}")

    # Сохраняем метаинформацию
    save(OUT_DIR / "meta.json", {
        "generated": date.today().isoformat(),
        "months": [{"month": m, "year": y} for m, y in months],
        "groups_count": len(group_ids),
        "staff_count": len(staff_ids),
        "errors": errors,
    })


if __name__ == "__main__":
    main()
