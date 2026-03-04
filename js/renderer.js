import {
    esc, stripHtml, pad2, fmtDate, parseDate, timeStr,
    MONTH_NAMES_GEN, WEEKDAYS, WEEKDAYS_SHORT,
    getMonday, addDays, isSameDay, formatWeekRange
} from './utils.js';

// ── Разбор сырых данных в структуру по дням ──
export function parseScheduleData(data) {
    var ltMap = {}, ltKeys = [];
    data.lessonTimes.forEach(function (lt) { ltMap[lt.id] = lt; ltKeys.push(lt.id); });
    ltKeys.sort(function (a, b) {
        return (ltMap[a].hour_from * 60 + ltMap[a].minute_from) - (ltMap[b].hour_from * 60 + ltMap[b].minute_from);
    });

    var lte = data.lessonTimesEnabled, daySlots = {};
    var cur = parseDate(data.start_date), end = parseDate(data.end_date);
    while (cur <= end) {
        if (lte[cur.getDay()]) {
            var ds = fmtDate(cur);
            daySlots[ds] = daySlots[ds] || {};
            lte[cur.getDay()].forEach(function (id) { daySlots[ds][id] = daySlots[ds][id] || []; });
        }
        cur = new Date(cur.valueOf() + 864e5);
    }

    data.lessons.forEach(function (l) {
        var ds = fmtDate(parseDate(l.date)), id = l.lesson_time_id;
        daySlots[ds] = daySlots[ds] || {};
        (daySlots[ds][id] = daySlots[ds][id] || []).push(l);
    });

    return { ltMap: ltMap, ltKeys: ltKeys, daySlots: daySlots, raw: data };
}

// ── Объединить несколько parsed-результатов в один ──
export function mergeScheduleData(parsedList) {
    if (!parsedList.length) return null;
    if (parsedList.length === 1) return parsedList[0];
    var merged = { ltMap: {}, ltKeys: [], daySlots: {}, raw: parsedList[0].raw };
    var ltSet = {};
    parsedList.forEach(function (p) {
        // Merge lesson times
        p.ltKeys.forEach(function (k) {
            if (!ltSet[k]) {
                ltSet[k] = true;
                merged.ltMap[k] = p.ltMap[k];
            }
        });
        // Merge daySlots
        Object.keys(p.daySlots).forEach(function (ds) {
            if (!merged.daySlots[ds]) {
                merged.daySlots[ds] = p.daySlots[ds];
            } else {
                Object.keys(p.daySlots[ds]).forEach(function (ltId) {
                    if (!merged.daySlots[ds][ltId]) {
                        merged.daySlots[ds][ltId] = p.daySlots[ds][ltId];
                    } else {
                        merged.daySlots[ds][ltId] = merged.daySlots[ds][ltId].concat(p.daySlots[ds][ltId]);
                    }
                });
            }
        });
    });
    // Sort ltKeys
    merged.ltKeys = Object.keys(ltSet).map(Number).sort(function (a, b) {
        return (merged.ltMap[a].hour_from * 60 + merged.ltMap[a].minute_from) -
               (merged.ltMap[b].hour_from * 60 + merged.ltMap[b].minute_from);
    });
    return merged;
}

// ── Получить список дней для конкретной недели ──
export function getDaysForWeek(daySlots, monday) {
    var sunday = addDays(monday, 6);
    var dayKeys = Object.keys(daySlots).sort(function (a, b) { return parseDate(a) - parseDate(b); });
    return dayKeys.filter(function (ds) {
        var d = parseDate(ds);
        return d >= monday && d <= sunday;
    });
}

// ── Получить все недели, которые есть в данных ──
export function getWeeksFromData(daySlots) {
    var dayKeys = Object.keys(daySlots).sort(function (a, b) { return parseDate(a) - parseDate(b); });
    if (!dayKeys.length) return [];
    var weeks = [];
    var seen = {};
    dayKeys.forEach(function (ds) {
        var mon = getMonday(parseDate(ds));
        var key = fmtDate(mon);
        if (!seen[key]) {
            seen[key] = true;
            weeks.push(mon);
        }
    });
    return weeks;
}

// ── Рендер недельной навигации (мини-календарь) ──
export function renderWeekDots(container, daySlots, currentMonday, onSelectWeek) {
    var weeks = getWeeksFromData(daySlots);
    container.innerHTML = '';
    if (!weeks.length) return;

    weeks.forEach(function (mon) {
        var dot = document.createElement('button');
        var isActive = isSameDay(mon, currentMonday);
        dot.className = 'week-dot' + (isActive ? ' active' : '');
        var end = addDays(mon, 6);
        dot.textContent = mon.getDate() + '–' + end.getDate();
        dot.title = formatWeekRange(mon);
        dot.addEventListener('click', function () { onSelectWeek(mon); });
        container.appendChild(dot);
    });
}

// ── Рендер расписания (только указанные дни) ──
export function renderDays(container, parsed, dayKeys, offlineTs) {
    container.innerHTML = '';
    var data = parsed.raw, ltMap = parsed.ltMap, ltKeys = parsed.ltKeys, daySlots = parsed.daySlots;

    if (!dayKeys.length) {
        container.innerHTML = '<div class="text-center py-4 text-muted"><i class="fas fa-couch fa-2x mb-2 d-block"></i>На этой неделе нет занятий</div>';
        return;
    }

    if (offlineTs) {
        var d = new Date(offlineTs);
        var banner = document.createElement('div');
        banner.className = 'offline-banner';
        banner.innerHTML = '<i class="fas fa-wifi-slash me-2"></i>Офлайн-режим. Данные от ' +
            pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' +
            pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        container.appendChild(banner);
    }

    var wrap = document.createElement('div');
    wrap.className = 'd-flex flex-column gap-3';

    dayKeys.forEach(function (ds) {
        var date = parseDate(ds), slots = daySlots[ds];
        if (!slots) return;
        var isToday = isSameDay(date, new Date());

        var card = document.createElement('div');
        card.className = 'day-card' + (isToday ? ' today' : '');
        card.innerHTML =
            '<div class="day-card-header' + (isToday ? ' today' : '') + '">' +
            '<div class="day-date">' + date.getDate() + '</div>' +
            '<div class="day-meta"><div class="day-weekday">' + WEEKDAYS[date.getDay()] + (isToday ? ' <span class="today-badge">сегодня</span>' : '') + '</div>' +
            '<div class="day-fulldate">' + date.getDate() + ' ' + MONTH_NAMES_GEN[date.getMonth()] + ' ' + date.getFullYear() + '</div></div></div>';

        var bodyHTML = '', hasContent = false, pairNum = 0;
        ltKeys.forEach(function (ltId) {
            if (!slots[ltId]) return;
            pairNum++;
            var lessons = slots[ltId], lt = ltMap[ltId];
            var label = pairNum + ' пара', range = timeStr(lt);

            if (!lessons.length) {
                bodyHTML +=
                    '<div class="lesson-slot"><div class="lesson-time">' +
                    '<div class="time-num">' + esc(label) + '</div><div class="time-range">' + range + '</div></div>' +
                    '<div class="lesson-row is-empty"><div class="lesson-details"><div class="lesson-discipline">Нет занятия</div></div></div></div>';
                hasContent = true;
                return;
            }

            lessons.forEach(function (item, j) {
                var empty = item.is_empty == 1, self = item.self_work == 1;
                var modified = item.id < 0 || item.modified == 1, first = j === 0;
                var multi = lessons.length > 1;
                var cls = 'lesson-row' + (empty || self ? ' is-empty' : '') + (modified ? ' is-modified' : '');
                var disc = empty ? 'Пустая пара' : self ? 'Самоподготовка' : esc(item.discipline || '');

                var cleanRoom = stripHtml(item.classroom || '');
                var info = [];
                if (item.class_type_name) info.push('<span class="info-item"><i class="fas fa-bookmark"></i>' + esc(item.class_type_name) + '</span>');
                if (cleanRoom) info.push('<span class="info-item"><i class="fas fa-door-open"></i>' + esc(cleanRoom) + '</span>');
                if (item.staffNames && item.staffNames.length) info.push('<span class="info-item"><i class="fas fa-user-tie"></i>' + esc(item.staffNames.join(', ')) + '</span>');

                var group = '';
                if (item.groupName && !empty && !self) {
                    var sf = [];
                    (item.superflowGroupsIds || []).forEach(function (v) { if (data.groupNames) sf.push(esc(data.groupNames[v])); });
                    (item.superflowSubgroupsIds || []).forEach(function (v) { if (data.subgroupNames) sf.push(esc(data.subgroupNames[v])); });
                    group = '<div class="lesson-group-name"><i class="fas fa-users me-1"></i>' + esc(item.groupName) + (sf.length ? ', ' + sf.join(', ') : '') + '</div>';
                }

                if (first && multi) {
                    bodyHTML += '<div class="lesson-slot" style="grid-template-rows:repeat(' + lessons.length + ',auto)">';
                    bodyHTML += '<div class="lesson-time">' +
                        '<div class="time-num">' + esc(label) + '</div><div class="time-range">' + range + '</div></div>';
                } else if (first) {
                    bodyHTML += '<div class="lesson-slot">';
                    bodyHTML += '<div class="lesson-time">' +
                        '<div class="time-num">' + esc(label) + '</div><div class="time-range">' + range + '</div></div>';
                }

                bodyHTML +=
                    '<div class="' + cls + '">' +
                    '<div class="lesson-details"><div class="lesson-discipline">' + disc + '</div>' +
                    (info.length ? '<div class="lesson-info">' + info.join('') + '</div>' : '') + group + '</div></div>';
                hasContent = true;

                if (j === lessons.length - 1) {
                    bodyHTML += '</div>';
                }
            });
        });

        if (hasContent) {
            var body = document.createElement('div');
            body.className = 'day-card-body';
            body.innerHTML = bodyHTML;
            card.appendChild(body);
            wrap.appendChild(card);
        }
    });

    container.appendChild(wrap);
}
