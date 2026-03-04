import { esc, $, $$, fetchJSON, DATA_BASE, getMonday, fmtDate, formatWeekRange } from './utils.js';
import { storageGet, storageSet, getSavedGroups, setSavedGroups, isGroupSaved, cacheSchedule, getCachedSchedule, clearGroupCache } from './storage.js';
import { parseScheduleData, mergeScheduleData, getDaysForWeek, getWeeksFromData, renderDays } from './renderer.js';

// ── State ──
var state = {
    groupsData: null,
    allGroups: [],
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
export function loadStudentsData() {
    fetchJSON(DATA_BASE + 'meta.json').then(function (meta) {
        state.availableMonths = meta.months || [];
        return fetchJSON(DATA_BASE + 'students.json');
    }).then(function (groups) {
        state.groupsData = groups;
        state.loaded = true;
        hideLoading();
        buildFlatGroupsList();
        initStudentsUI();
        restoreStudentState();
    }).catch(function () {
        var saved = getSavedGroups();
        if (saved.length) {
            state.loaded = true;
            hideLoading();
            initStudentsUI();
            disableStudentSelects();
            renderSavedGroups();
            selectGroup(saved[0].id);
        } else {
            showError();
        }
    });
}

export function isStudentsLoaded() { return state.loaded; }

// ── Helpers ──
function hideLoading() {
    var el = $('#loading');
    if (el) el.classList.add('d-none');
}
function showError() {
    hideLoading();
    var el = $('#error-block');
    if (el) el.classList.remove('d-none');
}

function buildFlatGroupsList() {
    state.allGroups = [];
    var data = state.groupsData;
    if (!data) return;
    Object.keys(data).forEach(function (dk) {
        var dept = data[dk];
        if (!dept.items) return;
        Object.keys(dept.items).forEach(function (ck) {
            var course = dept.items[ck];
            if (!course.items) return;
            Object.keys(course.items).forEach(function (gk) {
                var g = course.items[gk];
                state.allGroups.push({
                    id: g.id, name: g.name,
                    deptKey: dk, deptName: dept.name,
                    courseKey: ck, courseName: course.name
                });
            });
        });
    });
}

function initStudentsUI() {
    var tabEl = $('#tab-students');
    if (!tabEl) return;
    tabEl.classList.remove('d-none');

    var selDept = $('#sel-dept');
    if (state.groupsData) {
        Object.keys(state.groupsData).forEach(function (k) {
            var dept = state.groupsData[k];
            if (!dept.items || !Object.keys(dept.items).length) return;
            var opt = document.createElement('option');
            opt.value = k;
            opt.textContent = dept.name;
            selDept.appendChild(opt);
        });
    }
    renderSavedGroups();
}

export function populateCourses(deptKey) {
    var sel = $('#sel-course');
    sel.innerHTML = '<option value="">— Выберите —</option>';
    var selG = $('#sel-group');
    selG.innerHTML = '<option value="">— Выберите —</option>';
    selG.disabled = true;
    if (!deptKey || !state.groupsData || !state.groupsData[deptKey] || !state.groupsData[deptKey].items) {
        sel.disabled = true;
        return;
    }
    var items = state.groupsData[deptKey].items;
    Object.keys(items).forEach(function (k) {
        var opt = document.createElement('option');
        opt.value = k;
        opt.textContent = items[k].name;
        sel.appendChild(opt);
    });
    sel.disabled = false;
}

export function populateGroups(deptKey, courseKey) {
    var sel = $('#sel-group');
    sel.innerHTML = '<option value="">— Выберите —</option>';
    if (!deptKey || !courseKey || !state.groupsData) { sel.disabled = true; return; }
    var dept = state.groupsData[deptKey];
    if (!dept || !dept.items || !dept.items[courseKey] || !dept.items[courseKey].items) { sel.disabled = true; return; }
    var items = dept.items[courseKey].items;
    Object.keys(items).forEach(function (k) {
        var opt = document.createElement('option');
        opt.value = items[k].id;
        opt.textContent = items[k].name;
        sel.appendChild(opt);
    });
    sel.disabled = false;
}

export function selectGroup(id) {
    state.selectedId = id;
    storageSet('stu_group', id);
    var g = state.allGroups.filter(function (x) { return String(x.id) === String(id); });
    if (g.length) {
        var bar = $('#current-group-bar');
        var name = $('#current-group-name');
        if (name) name.textContent = g[0].name;
        if (bar) bar.classList.remove('d-none');
    }
    updateSaveButton();
    renderSavedGroups();
    loadStudentSchedule();
}

export function saveGroup(id) {
    var g = state.allGroups.filter(function (x) { return String(x.id) === String(id); });
    if (!g.length || isGroupSaved(id)) return;
    var list = getSavedGroups();
    list.push({ id: g[0].id, name: g[0].name, deptKey: g[0].deptKey, courseKey: g[0].courseKey });
    setSavedGroups(list);
    renderSavedGroups();
    updateSaveButton();
}

export function removeGroup(id) {
    var list = getSavedGroups().filter(function (g) { return String(g.id) !== String(id); });
    setSavedGroups(list);
    clearGroupCache(id);
    renderSavedGroups();
    updateSaveButton();
}

export function toggleSaveGroup() {
    if (!state.selectedId) return;
    if (isGroupSaved(state.selectedId)) removeGroup(state.selectedId);
    else saveGroup(state.selectedId);
}

export function getSelectedId() { return state.selectedId; }

function renderSavedGroups() {
    var sec = $('#saved-groups-section');
    var cont = $('#saved-groups-list');
    if (!sec || !cont) return;
    var list = getSavedGroups();
    if (!list.length) { sec.classList.add('d-none'); return; }
    sec.classList.remove('d-none');
    cont.innerHTML = '';
    list.forEach(function (g) {
        var active = String(g.id) === String(state.selectedId) ? ' active' : '';
        var div = document.createElement('div');
        div.className = 'saved-group-item' + active;
        div.dataset.id = g.id;
        div.dataset.dept = g.deptKey;
        div.dataset.course = g.courseKey;
        div.innerHTML = '<span class="saved-group-name">' + esc(g.name) + '</span>' +
            '<button class="saved-group-remove" data-id="' + esc(g.id) + '" title="Удалить"><i class="fas fa-times"></i></button>';
        cont.appendChild(div);
    });
}

function updateSaveButton() {
    if (!state.selectedId) return;
    var btn = $('#btn-save-group');
    if (!btn) return;
    var saved = isGroupSaved(state.selectedId);
    btn.className = saved ? 'btn-save-group active' : 'btn-save-group';
    btn.title = saved ? 'Убрать из сохранённых' : 'Сохранить группу';
}

function disableStudentSelects() {
    $$('#sel-dept, #sel-course, #sel-group').forEach(function (s) { s.disabled = true; });
    var q = $('#stu-search');
    if (q) { q.disabled = true; q.placeholder = 'API недоступен'; }
}

// ── Недельная навигация ──
function setWeek(monday) {
    state.currentMonday = monday;
    var content = $('#stu-schedule-content');
    var weekLabel = $('#stu-week-label');
    if (!state.parsedSchedule || !content) return;

    var dayKeys = getDaysForWeek(state.parsedSchedule.daySlots, monday);
    renderDays(content, state.parsedSchedule, dayKeys, state.offlineTs || null);

    if (weekLabel) {
        weekLabel.textContent = formatWeekRange(monday);
    }

    // Scroll to today's card if visible
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

function loadStudentSchedule() {
    if (!state.selectedId) return;
    var el = $('#stu-schedule-content');
    if (!el) return;
    el.innerHTML = '<div class="content-spinner"><div class="spinner-border spinner-border-sm text-primary"></div> Загрузка…</div>';
    var gid = state.selectedId;
    var months = state.availableMonths;
    if (!months.length) {
        // Fallback: current month + next
        var now = new Date();
        months = [{ month: now.getMonth() + 1, year: now.getFullYear() }];
    }

    // Load all available months in parallel and merge
    var promises = months.map(function (my) {
        return fetchJSON(DATA_BASE + 's/' + encodeURIComponent(gid) + '/' + my.month + '_' + my.year + '.json')
            .then(function (data) {
                if (isGroupSaved(gid)) cacheSchedule(gid, my.month, my.year, data);
                return { data: data, offline: false };
            }).catch(function () {
                var cached = getCachedSchedule(gid, my.month, my.year);
                if (cached) return { data: cached.data, offline: cached.ts };
                return null;
            });
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
        var el = $('#stu-schedule-content');
        if (el) el.innerHTML = '<div class="text-center py-4 text-muted"><i class="fas fa-calendar-times fa-2x mb-2 d-block"></i>Нет данных за этот период</div>';
        return;
    }
    // Ищем текущую неделю, иначе ближайшую к сегодня
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
    var dd = $('#stu-search-results');
    if (!dd) return;
    if (!query || query.length < 2) { dd.classList.add('d-none'); return; }
    var q = query.toLowerCase();
    var matches = state.allGroups.filter(function (g) {
        return g.name.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 15);
    dd.innerHTML = '';
    if (!matches.length) {
        dd.innerHTML = '<div class="search-empty">Ничего не найдено</div>';
    } else {
        matches.forEach(function (g) {
            var div = document.createElement('div');
            div.className = 'search-item';
            div.dataset.id = g.id;
            div.dataset.dept = g.deptKey;
            div.dataset.course = g.courseKey;
            div.innerHTML = esc(g.name) + '<small>' + esc(g.deptName) + ' · ' + esc(g.courseName) + '</small>';
            dd.appendChild(div);
        });
    }
    dd.classList.remove('d-none');
}

function restoreStudentState() {
    var saved = storageGet('stu_group');
    if (saved) {
        var f = state.allGroups.filter(function (g) { return String(g.id) === String(saved); });
        if (f.length) {
            var selDept = $('#sel-dept');
            if (selDept) selDept.value = f[0].deptKey;
            populateCourses(f[0].deptKey);
            var selCourse = $('#sel-course');
            if (selCourse) selCourse.value = f[0].courseKey;
            populateGroups(f[0].deptKey, f[0].courseKey);
            var selGroup = $('#sel-group');
            if (selGroup) selGroup.value = f[0].id;
            selectGroup(f[0].id);
        }
    }
}
