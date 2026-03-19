import { isVK, platformStorageGetMany, platformStorageSet, platformStorageRemove } from './platform.js';

var CORE_SYNC_KEYS = ['active_tab', 'stu_group', 'tch_staff', 'saved_groups'];

// ── localStorage обёртка ──
export function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

export function storageSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* quota */ }
    mirrorToPlatform(key, val);
}

export function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ok */ }
    mirrorRemoveFromPlatform(key);
}

export function storageInit() {
    if (!isVK) return Promise.resolve();

    return platformStorageGetMany(CORE_SYNC_KEYS).then(function (map) {
        CORE_SYNC_KEYS.forEach(function (key) {
            var val = map[key];
            if (val == null) return;
            try { localStorage.setItem(key, val); } catch (e) { /* quota */ }
        });
    }).catch(function () {
        // If VK Storage is unavailable, app still works with localStorage.
    });
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

function isSyncableKey(key) {
    return CORE_SYNC_KEYS.indexOf(key) !== -1;
}

function mirrorToPlatform(key, value) {
    if (!isVK || !isSyncableKey(key)) return;
    platformStorageSet(key, value).catch(function () {
        // Silent fallback: local storage remains source of truth for this session.
    });
}

function mirrorRemoveFromPlatform(key) {
    if (!isVK || !isSyncableKey(key)) return;
    platformStorageRemove(key).catch(function () {
        // Silent fallback.
    });
}
