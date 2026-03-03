// ── Утилиты и хелперы ──
export function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function pad2(n) { return ('0' + n).slice(-2); }

export function fmtDate(d) {
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
}

export function parseDate(s) {
    var m = s.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date(NaN);
}

export function timeStr(lt) {
    return pad2(lt.hour_from) + ':' + pad2(lt.minute_from) + ' – ' + pad2(lt.hour_to) + ':' + pad2(lt.minute_to);
}

export function $(sel, ctx) { return (ctx || document).querySelector(sel); }
export function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

export function fetchJSON(url) {
    return fetch(url).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
    });
}

export var DATA_BASE = 'data/';

export var MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
export var MONTH_NAMES_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export var WEEKDAYS = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
export var WEEKDAYS_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

// ── Работа с датами/неделями ──
export function getMonday(d) {
    var dt = new Date(d);
    var day = dt.getDay();
    var diff = day === 0 ? -6 : 1 - day; // Пн = 1, Вс = 0 → сдвиг
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

export function addDays(d, n) {
    var dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
}

export function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

export function formatWeekRange(monday) {
    var sunday = addDays(monday, 6);
    var d1 = monday.getDate() + ' ' + MONTH_NAMES_GEN[monday.getMonth()];
    var d2 = sunday.getDate() + ' ' + MONTH_NAMES_GEN[sunday.getMonth()];
    if (monday.getFullYear() !== sunday.getFullYear()) {
        d1 += ' ' + monday.getFullYear();
    }
    return d1 + ' — ' + d2 + ' ' + sunday.getFullYear();
}
