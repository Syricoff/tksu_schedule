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
from threading import Lock, local

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

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
WORKERS = int(os.environ.get("WORKERS", "16"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "4"))
REQUEST_DELAY = float(os.environ.get("REQUEST_DELAY", "0"))

_print_lock = Lock()
_thread_local = local()


def _make_session():
    """Создаёт requests.Session с keep-alive и автоматическими retry."""
    s = requests.Session()
    s.headers["User-Agent"] = "TksuScheduleBot/1.0"
    retry = Retry(
        total=MAX_RETRIES,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    adapter = HTTPAdapter(
        max_retries=retry,
        pool_connections=WORKERS,
        pool_maxsize=WORKERS,
    )
    s.mount("https://", adapter)
    return s


def get_session():
    session = getattr(_thread_local, "session", None)
    if session is None:
        session = _make_session()
        _thread_local.session = session
    return session


def fetch_json(session, url):
    resp = session.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


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


def download_catalog(url, label):
    try:
        return fetch_json(get_session(), url)
    except Exception as e:
        print(f"Критическая ошибка: не удалось скачать каталог {label}: {e}")
        sys.exit(1)


def fetch_schedule(kind, base_url, token, item_id, month, year):
    if REQUEST_DELAY:
        time.sleep(REQUEST_DELAY)
    param = "group_id" if kind == "student" else "staff_id"
    out_dir = "s" if kind == "student" else "t"
    url = f"{base_url}?token={token}&{param}={item_id}&month={month}&year={year}"
    resp = fetch_json(get_session(), url)
    save(OUT_DIR / out_dir / item_id / f"{month}_{year}.json", resp["data"])


def main():
    if not TOKEN_STU or not TOKEN_TCH:
        print("Ошибка: укажите TOKEN_STUDENTS и TOKEN_TEACHERS в .env или переменных окружения")
        sys.exit(1)

    # ═══ Проверка доступности API ═══
    print("🔗 Проверка доступности API...")
    try:
        get_session().get(f"{API_STU}?token={TOKEN_STU}", timeout=10).raise_for_status()
        print("   API доступен")
    except Exception as e:
        print(f"❌ API недоступен: {e}")
        print("   Завершение. Используйте локальные данные из data/")
        sys.exit(1)

    months = get_months(MONTHS_AHEAD)
    errors = 0

    # ═══ Студенты: каталог ═══
    print("📚 Загрузка каталога групп...")
    print("👨‍🏫 Загрузка каталога преподавателей...")
    with ThreadPoolExecutor(max_workers=2) as pool:
        stu_future = pool.submit(download_catalog, f"{API_STU}?token={TOKEN_STU}", "студентов")
        tch_future = pool.submit(download_catalog, f"{API_TCH}?token={TOKEN_TCH}", "преподавателей")
        stu_resp = stu_future.result()
        tch_resp = tch_future.result()

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

    # ═══ Расписания ═══
    schedule_tasks = []
    for m, y in months:
        for gid in group_ids:
            schedule_tasks.append(("student", API_STU, TOKEN_STU, gid, m, y))
        for sid in staff_ids:
            schedule_tasks.append(("teacher", API_TCH, TOKEN_TCH, sid, m, y))

    total_tasks = len(schedule_tasks)
    total_stu = len(group_ids) * len(months)
    total_tch = len(staff_ids) * len(months)
    print(f"📅 Загрузка расписаний: {total_tasks} запросов ({WORKERS} потоков)...")
    done = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_schedule, *t): t for t in schedule_tasks}
        for fut in as_completed(futures):
            done += 1
            t = futures[fut]
            try:
                fut.result()
            except Exception as e:
                errors += 1
                with _print_lock:
                    kind, _, _, item_id, _, _ = t
                    subject = "группа" if kind == "student" else "преподаватель"
                    print(f"   ⚠ {subject} {item_id}: {e}")
            if done % 100 == 0:
                with _print_lock:
                    print(f"   ... {done}/{total_tasks}")

    print(f"\n✅ Готово! Данные сохранены в {OUT_DIR}/")
    if errors:
        print(f"⚠ Ошибок: {errors}")
    print(f"   Студенческих расписаний: {total_stu}")
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
