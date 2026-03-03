import { esc, $, $$, fetchJSON, DATA_BASE, MONTH_NAMES, getMonday, fmtDate, formatWeekRange } from './utils.js';
import { storageGet, storageSet } from './storage.js';
import { parseScheduleData, getDaysForWeek, getWeeksFromData, renderDays } from './renderer.js';

// ── State ──
var state = {
    departments: null,
    staffData: null,
    allStaff: [],
    selectedId: null,
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    loaded: false,
    // Недельная пагинация
    currentMonday: null,
    parsedSchedule: null,
    offlineTs: null
};

// ── Public API ──
export function loadTeachersData() {
    var loading = $('#loading');
    if (loading) loading.classList.remove('d-none');

    fetchJSON(DATA_BASE + 'teachers.json').then(function (data) {
        state.departments = data.departments;
        state.staffData = data.staff;
        state.loaded = true;
        var ld = $('#loading');
        if (ld) ld.classList.add('d-none');
        buildFlatStaffList();
        initTeachersUI();
        restoreTeacherState();
    }).catch(function () {
        var ld = $('#loading');
        if (ld) ld.classList.add('d-none');
        var el = $('#tch-schedule-content');
        if (el) el.innerHTML = '<div class="alert alert-danger m-3"><i class="fas fa-exclamation-triangle me-2"></i>Не удалось загрузить данные преподавателей.</div>';
    });
}

export function isTeachersLoaded() { return state.loaded; }

function buildFlatStaffList() {
    state.allStaff = [];
    if (!state.staffData || !state.departments) return;
    Object.keys(state.staffData).forEach(function (deptId) {
        var deptName = state.departments[deptId] || '';
        var members = state.staffData[deptId];
        Object.keys(members).forEach(function (id) {
            state.allStaff.push({ id: id, name: members[id].shortName, deptId: deptId, deptName: deptName });
        });
    });
}

function initTeachersUI() {
    var tabEl = $('#tab-teachers');
    if (!tabEl) return;
    tabEl.classList.remove('d-none');

    var savedM = storageGet('tch_month');
    var savedY = storageGet('tch_year');
    if (savedM) state.month = +savedM;
    if (savedY) state.year = +savedY;
    updateMonthDisplay();

    var selDept = $('#sel-tch-dept');
    if (state.departments) {
        Object.keys(state.departments).forEach(function (id) {
            if (!state.staffData[id] || !Object.keys(state.staffData[id]).length) return;
            var opt = document.createElement('option');
            opt.value = id;
            opt.textContent = state.departments[id];
            selDept.appendChild(opt);
        });
    }
}

function updateMonthDisplay() {
    var el = $('#tch-month-label');
    if (el) el.textContent = MONTH_NAMES[state.month - 1] + ' ' + state.year;
}

export function changeMonth(dir) {
    state.month += dir;
    if (state.month <= 0) { state.month = 12; state.year--; }
    else if (state.month >= 13) { state.month = 1; state.year++; }
    storageSet('tch_month', state.month);
    storageSet('tch_year', state.year);
    updateMonthDisplay();
    loadTeacherSchedule();
}

export function populateStaff(deptId) {
    var sel = $('#sel-staff');
    sel.innerHTML = '<option value="">— Выберите —</option>';
    if (!deptId || !state.staffData || !state.staffData[deptId]) { sel.disabled = true; return; }
    var members = state.staffData[deptId];
    Object.keys(members).forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = members[id].shortName;
        sel.appendChild(opt);
    });
    sel.disabled = false;
}

export function selectStaff(id) {
    state.selectedId = id;
    storageSet('tch_staff', id);
    loadTeacherSchedule();
}

// ── Недельная навигация ──
function setWeek(monday) {
    state.currentMonday = monday;
    var content = $('#tch-schedule-content');
    var weekLabel = $('#tch-week-label');
    if (!state.parsedSchedule || !content) return;

    var dayKeys = getDaysForWeek(state.parsedSchedule.daySlots, monday);
    renderDays(content, state.parsedSchedule, dayKeys, state.offlineTs);

    if (weekLabel) {
        weekLabel.textContent = formatWeekRange(monday);
    }
}

export function changeWeek(dir) {
    if (!state.currentMonday) return;
    var weeks = state.parsedSchedule ? getWeeksFromData(state.parsedSchedule.daySlots) : [];
    var curIdx = -1;
    var curKey = fmtDate(state.currentMonday);
    weeks.forEach(function (w, i) { if (fmtDate(w) === curKey) curIdx = i; });
    var newIdx = curIdx + dir;
    if (newIdx >= 0 && newIdx < weeks.length) {
        setWeek(weeks[newIdx]);
    }
}

export function goToCurrentWeek() {
    if (!state.parsedSchedule) return;
    var today = getMonday(new Date());
    var weeks = getWeeksFromData(state.parsedSchedule.daySlots);
    var closest = weeks.length ? weeks[0] : today;
    var minDiff = Infinity;
    weeks.forEach(function (w) {
        var diff = Math.abs(w - today);
        if (diff < minDiff) { minDiff = diff; closest = w; }
    });
    setWeek(closest);
}

function loadTeacherSchedule() {
    if (!state.selectedId) return;
    var el = $('#tch-schedule-content');
    if (!el) return;
    el.innerHTML = '<div class="content-spinner"><div class="spinner-border spinner-border-sm text-primary"></div> Загрузка…</div>';

    var weekNav = $('#tch-week-nav');
    if (weekNav) weekNav.classList.remove('d-none');

    fetchJSON(DATA_BASE + 't/' + encodeURIComponent(state.selectedId) + '/' + state.month + '_' + state.year + '.json')
        .then(function (data) {
            state.parsedSchedule = parseScheduleData(data);
            state.offlineTs = null;
            initWeekFromData();
        }).catch(function () {
            el.innerHTML = '<div class="alert alert-warning m-3"><i class="fas fa-exclamation-circle me-2"></i>Нет данных за этот период. Попробуйте выбрать другой месяц.</div>';
            if (weekNav) weekNav.classList.add('d-none');
        });
}

function initWeekFromData() {
    if (!state.parsedSchedule) return;
    var weeks = getWeeksFromData(state.parsedSchedule.daySlots);
    if (!weeks.length) {
        var el = $('#tch-schedule-content');
        if (el) el.innerHTML = '<div class="text-center py-4 text-muted"><i class="fas fa-calendar-times fa-2x mb-2 d-block"></i>Нет данных за этот период</div>';
        return;
    }
    var today = getMonday(new Date());
    var target = weeks[0];
    weeks.forEach(function (w) {
        if (fmtDate(w) === fmtDate(today)) target = w;
    });
    setWeek(target);
}

export function showSearchResults(query) {
    var dd = $('#tch-search-results');
    if (!dd) return;
    if (!query || query.length < 2) { dd.classList.add('d-none'); return; }
    var q = query.toLowerCase();
    var matches = state.allStaff.filter(function (s) {
        return s.name.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 15);
    dd.innerHTML = '';
    if (!matches.length) {
        dd.innerHTML = '<div class="search-empty">Ничего не найдено</div>';
    } else {
        matches.forEach(function (s) {
            var div = document.createElement('div');
            div.className = 'search-item';
            div.dataset.id = s.id;
            div.dataset.dept = s.deptId;
            div.innerHTML = esc(s.name) + '<small>' + esc(s.deptName) + '</small>';
            dd.appendChild(div);
        });
    }
    dd.classList.remove('d-none');
}

function restoreTeacherState() {
    var saved = storageGet('tch_staff');
    if (saved) {
        var f = state.allStaff.filter(function (s) { return String(s.id) === String(saved); });
        if (f.length) {
            var selDept = $('#sel-tch-dept');
            if (selDept) selDept.value = f[0].deptId;
            populateStaff(f[0].deptId);
            var selStaff = $('#sel-staff');
            if (selStaff) selStaff.value = f[0].id;
            selectStaff(f[0].id);
        }
    }
}
