import { fetchJSON, DATA_BASE } from './utils.js';

var API_STU = 'https://apeks.tksu.ru/api/call/schedule-schedule/student';
var API_TCH = 'https://apeks.tksu.ru/api/call/schedule-schedule/staff';

var LS_SOURCE_KEY = 'tksu_data_source';
var LS_STU_TOKEN_KEY = 'tksu_token_students';
var LS_TCH_TOKEN_KEY = 'tksu_token_teachers';

function readSearchParam(name) {
    try {
        return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
        return null;
    }
}

function saveIfProvided(lsKey, value) {
    if (!value) return;
    try { localStorage.setItem(lsKey, value); } catch (e) { /* ignore quota */ }
}

function getLS(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

function normalizeSource(value) {
    if (value === 'api' || value === 'static' || value === 'auto') return value;
    return null;
}

function getSourceMode() {
    var querySource = normalizeSource(readSearchParam('source'));
    if (querySource) saveIfProvided(LS_SOURCE_KEY, querySource);
    return querySource || normalizeSource(getLS(LS_SOURCE_KEY)) || 'api';
}

function getToken(kind) {
    var queryKey = kind === 'students' ? 'token_students' : 'token_teachers';
    var lsKey = kind === 'students' ? LS_STU_TOKEN_KEY : LS_TCH_TOKEN_KEY;
    var queryToken = readSearchParam(queryKey);
    if (queryToken) saveIfProvided(lsKey, queryToken);
    return queryToken || getLS(lsKey) || '';
}

function shouldTryApi(kind) {
    var source = getSourceMode();
    if (source === 'static') return false;
    return !!getToken(kind);
}

function getDefaultMonths(count) {
    var now = new Date();
    var month = now.getMonth() + 1;
    var year = now.getFullYear();
    var out = [];
    var i;
    for (i = 0; i < count; i++) {
        out.push({ month: month, year: year });
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }
    return out;
}

export function loadMonthsMeta() {
    return fetchJSON(DATA_BASE + 'meta.json')
        .then(function (meta) {
            if (meta && Array.isArray(meta.months) && meta.months.length) {
                return meta.months;
            }
            return getDefaultMonths(4);
        })
        .catch(function () {
            return getDefaultMonths(4);
        });
}

export function loadStudentsCatalog() {
    var source = getSourceMode();
    if (shouldTryApi('students')) {
        var token = encodeURIComponent(getToken('students'));
        return fetchJSON(API_STU + '?token=' + token)
            .then(function (resp) {
                if (!resp || !resp.data || !resp.data.groups) throw new Error('bad_api_response');
                return resp.data.groups;
            })
            .catch(function () {
                return fetchJSON(DATA_BASE + 'students.json');
            });
    }

    if (source === 'api') {
        return fetchJSON(DATA_BASE + 'students.json');
    }

    return fetchJSON(DATA_BASE + 'students.json');
}

export function loadTeachersCatalog() {
    var source = getSourceMode();
    if (shouldTryApi('teachers')) {
        var token = encodeURIComponent(getToken('teachers'));
        return fetchJSON(API_TCH + '?token=' + token)
            .then(function (resp) {
                if (!resp || !resp.data || !resp.data.departments || !resp.data.staff) {
                    throw new Error('bad_api_response');
                }
                return {
                    departments: resp.data.departments,
                    staff: resp.data.staff
                };
            })
            .catch(function () {
                return fetchJSON(DATA_BASE + 'teachers.json');
            });
    }

    if (source === 'api') {
        return fetchJSON(DATA_BASE + 'teachers.json');
    }

    return fetchJSON(DATA_BASE + 'teachers.json');
}

export function loadStudentScheduleMonth(groupId, month, year) {
    if (shouldTryApi('students')) {
        var token = encodeURIComponent(getToken('students'));
        var url = API_STU + '?token=' + token + '&group_id=' + encodeURIComponent(groupId) + '&month=' + month + '&year=' + year;
        return fetchJSON(url)
            .then(function (resp) {
                if (!resp || !resp.data) throw new Error('bad_api_response');
                return resp.data;
            })
            .catch(function () {
                return fetchJSON(DATA_BASE + 's/' + encodeURIComponent(groupId) + '/' + month + '_' + year + '.json');
            });
    }

    return fetchJSON(DATA_BASE + 's/' + encodeURIComponent(groupId) + '/' + month + '_' + year + '.json');
}

export function loadTeacherScheduleMonth(staffId, month, year) {
    if (shouldTryApi('teachers')) {
        var token = encodeURIComponent(getToken('teachers'));
        var url = API_TCH + '?token=' + token + '&staff_id=' + encodeURIComponent(staffId) + '&month=' + month + '&year=' + year;
        return fetchJSON(url)
            .then(function (resp) {
                if (!resp || !resp.data) throw new Error('bad_api_response');
                return resp.data;
            })
            .catch(function () {
                return fetchJSON(DATA_BASE + 't/' + encodeURIComponent(staffId) + '/' + month + '_' + year + '.json');
            });
    }

    return fetchJSON(DATA_BASE + 't/' + encodeURIComponent(staffId) + '/' + month + '_' + year + '.json');
}
