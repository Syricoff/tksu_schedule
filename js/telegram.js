import { $ } from './utils.js';

// ── Telegram WebApp integration ──
var tg = window.Telegram && window.Telegram.WebApp;
export var isTelegram = !!(tg && tg.initData);

export function tgReady(onBack) {
    if (!isTelegram) return;
    tg.ready();
    tg.expand();
    tg.requestFullscreen();
    document.body.classList.add('tg-mode');
    var header = $('#app-header');
    var footer = $('#app-footer');
    if (header) header.style.display = 'none';
    if (footer) footer.style.display = 'none';
    applyTgTheme();
    applySafeArea();
    // Listen for safe area changes (fullscreen, rotation)
    tg.onEvent('safeAreaChanged', applySafeArea);
    tg.onEvent('contentSafeAreaChanged', applySafeArea);
    if (onBack) {
        tg.BackButton.onClick(onBack);
    }
}

export function tgShowBack() {
    if (isTelegram) tg.BackButton.show();
}

export function tgHideBack() {
    if (isTelegram) tg.BackButton.hide();
}

function applyTgTheme() {
    if (!isTelegram || !tg.themeParams) return;
    var tp = tg.themeParams;
    var root = document.documentElement.style;

    // In Telegram's design system:
    // secondary_bg_color = outer page background
    // section_bg_color / bg_color = card/surface background
    var pageBg = tp.secondary_bg_color || tp.bg_color;
    var cardBg = tp.section_bg_color || tp.bg_color;

    if (pageBg) root.setProperty('--bg', pageBg);
    if (cardBg) {
        // If page and card ended up the same, nudge card for contrast
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
    if (tp.header_bg_color) root.setProperty('--tg-header-bg', tp.header_bg_color);
}

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
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

function applySafeArea() {
    if (!isTelegram) return;
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
