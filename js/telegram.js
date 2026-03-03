import { $ } from './utils.js';

// ── Telegram WebApp integration ──
var tg = window.Telegram && window.Telegram.WebApp;
export var isTelegram = !!(tg && tg.initData);

export function tgReady(onBack) {
    if (!isTelegram) return;
    tg.ready();
    tg.expand();
    document.body.classList.add('tg-mode');
    var header = $('#app-header');
    var footer = $('#app-footer');
    if (header) header.style.display = 'none';
    if (footer) footer.style.display = 'none';
    applyTgTheme();
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
    if (tp.bg_color) root.setProperty('--bg', tp.bg_color);
    if (tp.secondary_bg_color) root.setProperty('--card-bg', tp.secondary_bg_color);
    if (tp.text_color) root.setProperty('--text', tp.text_color);
    if (tp.hint_color) root.setProperty('--text-muted', tp.hint_color);
    if (tp.button_color) root.setProperty('--primary', tp.button_color);
    if (tp.section_bg_color) root.setProperty('--card-bg', tp.section_bg_color);
}
