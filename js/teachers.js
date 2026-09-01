import { esc, $, $$, fetchJSON, DATA_BASE, getMonday, fmtDate, formatWeekRange } from './utils.js';
import { storageGet, storageSet } from './storage.js';
import { parseScheduleData, mergeScheduleData, getDaysForWeek, getWeeksFromData, renderDays } from './renderer.js';

// ── State ──
var state = {
    departments: null,
    staffData: null,
    allStaff: [],
    selectedId: null,
    availableMonths: [],
    loaded: false,
    // Недельная пагинация
    currentMonday: null,
    parsedSchedule: null,
    weeks: [],
    offlineTs: null
};

// ── Public API ──
export function loadTeachersData() {
    var loading = $('#loading');
    if (loading) loading.classList.remove('d-none');

    fetchJSON(DATA_BASE + 'meta.json').then(function (meta) {
        state.availableMonths = meta.months || [];
        return fetchJSON(DATA_BASE + 'teachers.json');
    }).then(function (data) {
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
    if (window.goatcounter) {
        var s = state.allStaff.filter(function (x) { return String(x.id) === String(id); });
        if (s.length) {
            window.goatcounter.count({ path: 'event-teacher/' + s[0].name, title: s[0].name, event: true });
        }
    }
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

    setTimeout(function () {
        var todayCard = content.querySelector('.day-card.today');
        if (todayCard) todayCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
}

export function changeWeek(dir) {
    if (!state.currentMonday || !state.weeks.length) return;
    var curIdx = -1;
    var curKey = fmtDate(state.currentMonday);
    state.weeks.forEach(function (w, i) { if (fmtDate(w) === curKey) curIdx = i; });
    var newIdx = curIdx + dir;
    if (newIdx >= 0 && newIdx < state.weeks.length) {
        setWeek(state.weeks[newIdx]);
    }
}

export function goToCurrentWeek() {
    if (!state.parsedSchedule || !state.weeks.length) return;
    var today = getMonday(new Date());
    var closest = state.weeks[0];
    var minDiff = Infinity;
    state.weeks.forEach(function (w) {
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

    var months = state.availableMonths;
    if (!months.length) {
        var now = new Date();
        months = [{ month: now.getMonth() + 1, year: now.getFullYear() }];
    }

    var promises = months.map(function (my) {
        return fetchJSON(DATA_BASE + 't/' + encodeURIComponent(state.selectedId) + '/' + my.month + '_' + my.year + '.json')
            .then(function (data) { return { data: data, offline: false }; })
            .catch(function () { return null; });
    });

    Promise.all(promises).then(function (results) {
        var parsedList = [], offlineTs = null;
        results.forEach(function (r) {
            if (!r) return;
            parsedList.push(parseScheduleData(r.data));
            if (r.offline) offlineTs = r.offline;
        });
        if (!parsedList.length) {
            el.innerHTML = '<div class="alert alert-warning m-3"><i class="fas fa-exclamation-circle me-2"></i>Нет данных. Попробуйте позже.</div>';
            return;
        }
        state.parsedSchedule = mergeScheduleData(parsedList);
        state.offlineTs = offlineTs;
        state.weeks = getWeeksFromData(state.parsedSchedule.daySlots);
        initWeekFromData();
    });
}

function initWeekFromData() {
    if (!state.parsedSchedule) return;
    if (!state.weeks.length) {
        var el = $('#tch-schedule-content');
        if (el) el.innerHTML = '<div class="text-center py-4 text-muted"><i class="fas fa-calendar-times fa-2x mb-2 d-block"></i>Нет данных за этот период</div>';
        return;
    }
    var today = getMonday(new Date());
    var target = state.weeks[0];
    var minDiff = Infinity;
    state.weeks.forEach(function (w) {
        var diff = Math.abs(w - today);
        if (diff < minDiff) { minDiff = diff; target = w; }
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
