import { $ } from './utils.js';

var tg = window.Telegram && window.Telegram.WebApp;

export var isTelegram = !!(tg && tg.initData);
export var platformName = isTelegram ? 'telegram' : 'browser';

var backHandler = null;

export function platformReady(onBack) {
    backHandler = onBack || null;
    if (isTelegram) {
        initTelegram();
        return Promise.resolve();
    }
    document.body.classList.add('browser-mode');
    return Promise.resolve();
}

export function platformShowBack() {
    if (isTelegram) {
        tg.BackButton.show();
        return;
    }
}

export function platformHideBack() {
    if (isTelegram) {
        tg.BackButton.hide();
        return;
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

function hideChrome() {
    var header = $('#app-header');
    var footer = $('#app-footer');
    if (header) header.style.display = 'none';
    if (footer) footer.style.display = 'none';
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
