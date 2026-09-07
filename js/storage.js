// ── localStorage обёртка ──
export function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

export function storageSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* quota */ }
}

export function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ok */ }
}

// ── Сохранённые группы ──
export function getSavedGroups() {
    try { return JSON.parse(storageGet('saved_groups') || '[]'); } catch (e) { return []; }
}

export function setSavedGroups(list) {
    storageSet('saved_groups', JSON.stringify(list));
}

export function isGroupSaved(id) {
    return getSavedGroups().some(function (g) { return String(g.id) === String(id); });
}

// ── Кэш расписаний ──
function scheduleKey(gid, m, y) { return 'sched_' + gid + '_' + m + '_' + y; }

export function cacheSchedule(gid, m, y, data) {
    storageSet(scheduleKey(gid, m, y), JSON.stringify({ ts: Date.now(), data: data }));
}

export function getCachedSchedule(gid, m, y) {
    try {
        var raw = storageGet(scheduleKey(gid, m, y));
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

export function clearGroupCache(gid) {
    var prefix = 'sched_' + gid + '_';
    for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) storageRemove(k);
    }
}
