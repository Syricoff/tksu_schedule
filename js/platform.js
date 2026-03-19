import { $ } from './utils.js';

var tg = window.Telegram && window.Telegram.WebApp;
var vkBridge = window.vkBridge;
var query = new URLSearchParams(window.location.search);

export var isTelegram = !!(tg && tg.initData);
export var isVK = !isTelegram && !!(vkBridge && typeof vkBridge.send === 'function') && (
    query.has('vk_platform') || query.has('vk_user_id') || query.has('sign')
);
export var platformName = isTelegram ? 'telegram' : (isVK ? 'vk' : 'browser');

var backHandler = null;
var vkBackVisible = false;
var vkPopStateBound = false;
var vkHistoryArmed = false;

export function platformReady(onBack) {
    backHandler = onBack || null;
    if (isTelegram) {
        initTelegram();
        return Promise.resolve();
    }
    if (isVK) {
        return initVK();
    }
    document.body.classList.add('browser-mode');
    return Promise.resolve();
}

export function platformShowBack() {
    if (isTelegram) {
        tg.BackButton.show();
        return;
    }
    if (isVK) {
        vkBackVisible = true;
        armVKBackHistory();
        tryVKSend('VKWebAppEnableSwipeBack');
        tryVKSend('VKWebAppSetSwipeSettings', { history: true });
    }
}

export function platformHideBack() {
    if (isTelegram) {
        tg.BackButton.hide();
        return;
    }
    if (isVK) {
        vkBackVisible = false;
        disarmVKBackHistory();
        tryVKSend('VKWebAppDisableSwipeBack');
        tryVKSend('VKWebAppSetSwipeSettings', { history: false });
    }
}

function initTelegram() {
    tg.ready();
    tg.expand();
    tg.requestFullscreen();

    document.body.classList.add('miniapp-mode');
    document.body.classList.add('tg-mode');
    hideChrome();
    applyTelegramTheme();
    applyTelegramSafeArea();

    tg.onEvent('safeAreaChanged', applyTelegramSafeArea);
    tg.onEvent('contentSafeAreaChanged', applyTelegramSafeArea);

    if (backHandler) {
        tg.BackButton.onClick(backHandler);
    }
}

function initVK() {
    document.body.classList.add('miniapp-mode');
    document.body.classList.add('vk-mode');
    hideChrome();

    return tryVKSend('VKWebAppInit').then(function () {
        return tryVKSend('VKWebAppGetConfig').then(function (cfg) {
            if (cfg) applyVKTheme(cfg);
        });
    }).finally(function () {
        bindVKThemeEvents();
        bindVKBackEvents();
    });
}

function hideChrome() {
    var header = $('#app-header');
    var footer = $('#app-footer');
    if (header) header.style.display = 'none';
    if (footer) footer.style.display = 'none';
}

function bindVKBackEvents() {
    if (vkPopStateBound) return;
    vkPopStateBound = true;

    window.addEventListener('popstate', function () {
        if (!vkBackVisible || !backHandler) return;
        backHandler();

        // Re-arm history marker when we still need in-app back in VK.
        if (vkBackVisible) {
            setTimeout(armVKBackHistory, 0);
        }
    });
}

function bindVKThemeEvents() {
    if (!vkBridge || typeof vkBridge.subscribe !== 'function') return;

    vkBridge.subscribe(function (event) {
        if (!event || event.detail == null) return;
        var type = event.detail.type;
        if (type === 'VKWebAppUpdateConfig') {
            applyVKTheme(event.detail.data || {});
            return;
        }

        // Fallback for environments where native back events are sent directly by container.
        if ((type === 'VKWebAppSwipeBack' || type === 'VKWebAppBackButtonPressed') && vkBackVisible && backHandler) {
            backHandler();
            if (vkBackVisible) {
                setTimeout(armVKBackHistory, 0);
            }
        }
    });

}

function armVKBackHistory() {
    if (!isVK || vkHistoryArmed) return;
    var state = window.history.state || {};
    if (state && state.__vk_back_marker) {
        vkHistoryArmed = true;
        return;
    }

    try {
        window.history.pushState({ __vk_back_marker: true }, document.title, window.location.href);
        vkHistoryArmed = true;
    } catch (e) {
        // Ignore browsers with restricted History API.
    }
}

function disarmVKBackHistory() {
    vkHistoryArmed = false;
    try {
        var state = window.history.state;
        if (state && state.__vk_back_marker) {
            window.history.replaceState({}, document.title, window.location.href);
        }
    } catch (e) {
        // Ignore History API restrictions.
    }
}

export function platformStorageGet(key) {
    if (!isVK) return Promise.resolve(readLocalStorage(key));
    return tryVKSend('VKWebAppStorageGet', { keys: [key] }).then(function (res) {
        return unwrapVKStorageValue(res, key);
    });
}

export function platformStorageGetMany(keys) {
    if (!isVK) {
        var localMap = {};
        keys.forEach(function (k) { localMap[k] = readLocalStorage(k); });
        return Promise.resolve(localMap);
    }
    return tryVKSend('VKWebAppStorageGet', { keys: keys }).then(function (res) {
        var out = {};
        keys.forEach(function (k) { out[k] = unwrapVKStorageValue(res, k); });
        return out;
    });
}

export function platformStorageSet(key, value) {
    writeLocalStorage(key, value);
    if (!isVK) return Promise.resolve();
    return tryVKSend('VKWebAppStorageSet', { key: key, value: String(value) }).then(function () {
        return;
    });
}

export function platformStorageRemove(key) {
    removeLocalStorage(key);
    if (!isVK) return Promise.resolve();
    return tryVKSend('VKWebAppStorageSet', { key: key, value: '' }).then(function () {
        return;
    });
}

function applyVKTheme(cfg) {
    var root = document.documentElement.style;
    var scheme = cfg.scheme || '';
    var appTheme = cfg.appearance || '';
    var dark = appTheme === 'dark' || scheme.indexOf('dark') !== -1;

    if (cfg.background_color) root.setProperty('--bg', cfg.background_color);
    if (cfg.background_secondary) root.setProperty('--card-bg', cfg.background_secondary);
    if (cfg.text_color) root.setProperty('--text', cfg.text_color);
    if (cfg.hint_color) root.setProperty('--text-muted', cfg.hint_color);
    if (cfg.separator_color) root.setProperty('--border', cfg.separator_color);

    if (cfg.accent_color) {
        root.setProperty('--primary', cfg.accent_color);
        root.setProperty('--primary-light', cfg.accent_color + '14');
    }

    document.body.classList.toggle('vk-dark', !!dark);
}

function applyTelegramTheme() {
    if (!tg.themeParams) return;

    var tp = tg.themeParams;
    var root = document.documentElement.style;

    var pageBg = tp.secondary_bg_color || tp.bg_color;
    var cardBg = tp.section_bg_color || tp.bg_color;

    if (pageBg) root.setProperty('--bg', pageBg);
    if (cardBg) {
        if (pageBg && cardBg.toLowerCase() === pageBg.toLowerCase()) {
            cardBg = nudgeColor(cardBg, isDark(cardBg) ? 10 : -6);
        }
        root.setProperty('--card-bg', cardBg);
    }

    if (tp.text_color) root.setProperty('--text', tp.text_color);
    if (tp.hint_color) root.setProperty('--text-muted', tp.hint_color);

    var accent = tp.accent_text_color || tp.button_color;
    if (accent) {
        root.setProperty('--primary', accent);
        root.setProperty('--primary-light', accent + '14');
    }

    if (tp.section_separator_color) root.setProperty('--border', tp.section_separator_color);
}

function applyTelegramSafeArea() {
    var root = document.documentElement.style;
    var sa = tg.safeAreaInset || {};
    var csa = tg.contentSafeAreaInset || {};

    root.setProperty('--tg-safe-area-inset-top', (sa.top || 0) + 'px');
    root.setProperty('--tg-safe-area-inset-bottom', (sa.bottom || 0) + 'px');
    root.setProperty('--tg-safe-area-inset-left', (sa.left || 0) + 'px');
    root.setProperty('--tg-safe-area-inset-right', (sa.right || 0) + 'px');
    root.setProperty('--tg-content-safe-area-inset-top', (csa.top || 0) + 'px');
    root.setProperty('--tg-content-safe-area-inset-bottom', (csa.bottom || 0) + 'px');
}

function tryVKSend(method, params) {
    if (!vkBridge || typeof vkBridge.send !== 'function') {
        return Promise.resolve(null);
    }
    return vkBridge.send(method, params || {}).catch(function () {
        return null;
    });
}

function unwrapVKStorageValue(res, key) {
    if (!res) return null;

    if (Array.isArray(res.keys)) {
        var row = res.keys.find(function (item) { return item && item.key === key; });
        if (!row) return null;
        return row.value == null || row.value === '' ? null : row.value;
    }

    if (Array.isArray(res.response)) {
        var item = res.response.find(function (entry) { return entry && entry.key === key; });
        if (!item) return null;
        return item.value == null || item.value === '' ? null : item.value;
    }

    if (Object.prototype.hasOwnProperty.call(res, key)) {
        return res[key] == null || res[key] === '' ? null : res[key];
    }

    return null;
}

function readLocalStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        return null;
    }
}

function writeLocalStorage(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch (e) {
        // ignore quota and private mode errors
    }
}

function removeLocalStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        // ignore private mode errors
    }
}

function hexToRgb(hex) {
    hex = String(hex || '').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function isDark(hex) {
    var c = hexToRgb(hex);
    return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 < 128;
}

function nudgeColor(hex, amount) {
    var c = hexToRgb(hex);
    var r = Math.min(255, Math.max(0, c[0] + amount));
    var g = Math.min(255, Math.max(0, c[1] + amount));
    var b = Math.min(255, Math.max(0, c[2] + amount));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
