export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  section_separator_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

export interface TelegramBackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(handler: () => void): void;
  offClick(handler: () => void): void;
}

export type HapticImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type HapticNotificationType = 'error' | 'success' | 'warning';

export interface TelegramHapticFeedback {
  impactOccurred(style: HapticImpactStyle): void;
  notificationOccurred(type: HapticNotificationType): void;
  selectionChanged(): void;
}

export interface TelegramCloudStorage {
  setItem(key: string, value: string, callback?: (error: Error | null, success?: boolean) => void): void;
  getItem(key: string, callback: (error: Error | null, value?: string) => void): void;
  getItems(keys: string[], callback: (error: Error | null, values?: Record<string, string>) => void): void;
  removeItem(key: string, callback?: (error: Error | null, success?: boolean) => void): void;
}

export interface TelegramSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
  };
  version?: string;
  platform?: string;
  colorScheme?: 'light' | 'dark';
  themeParams?: TelegramThemeParams;
  isExpanded?: boolean;
  viewportHeight?: number;
  viewportStableHeight?: number;
  headerColor?: string;
  backgroundColor?: string;
  safeAreaInset?: Partial<TelegramSafeAreaInset>;
  contentSafeAreaInset?: Partial<TelegramSafeAreaInset>;
  ready(): void;
  expand(): void;
  close?(): void;
  requestFullscreen?(): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  openLink?(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink?(url: string): void;
  onEvent(event: string, handler: () => void): void;
  offEvent(event: string, handler: () => void): void;
  BackButton: TelegramBackButton;
  HapticFeedback?: TelegramHapticFeedback;
  CloudStorage?: TelegramCloudStorage;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  const telegram = (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram;
  return telegram?.WebApp ?? null;
}

export function isTelegramEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const app = getTelegramWebApp();
  if (!app) return false;

  const isProxyPresent = Boolean((window as Window & { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy);
  const hasPlatform = Boolean(app.platform && app.platform !== 'unknown');
  const hasInitData = Boolean(app.initData && app.initData.length > 0);

  return isProxyPresent || hasPlatform || hasInitData;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function isColorDark(hex?: string): boolean {
  if (!hex || !hex.startsWith('#')) return false;
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

export function applyTelegramTheme(app: TelegramWebApp): void {
  const theme = app.themeParams ?? {};
  const root = document.documentElement.style;
  const dark = app.colorScheme === 'dark' || isColorDark(theme.bg_color);

  const pageBg = theme.secondary_bg_color || theme.bg_color || (dark ? '#17212b' : '#f4f4f5');
  const cardBg = theme.section_bg_color || theme.bg_color || (dark ? '#242f3d' : '#ffffff');
  const textColor = theme.text_color || (dark ? '#f5f5f5' : '#172033');
  const mutedColor = theme.hint_color || theme.subtitle_text_color || (dark ? '#8293a1' : '#687286');
  const accentColor = theme.accent_text_color || theme.button_color || '#2481cc';
  const borderColor = theme.section_separator_color || (dark ? 'rgba(255, 255, 255, 0.1)' : '#e3e6ea');

  root.setProperty('--tg-bg', pageBg);
  root.setProperty('--tg-card-bg', cardBg);
  root.setProperty('--tg-text', textColor);
  root.setProperty('--tg-muted', mutedColor);
  root.setProperty('--tg-accent', accentColor);
  root.setProperty('--tg-border', borderColor);

  // When in Telegram mode, synchronize the core variables so existing styles inherit Telegram's look
  root.setProperty('--bg', pageBg);
  root.setProperty('--card-bg', cardBg);
  root.setProperty('--text', textColor);
  root.setProperty('--text-muted', mutedColor);
  root.setProperty('--border', borderColor);
  root.setProperty('--primary', accentColor);
  root.setProperty('--ink', textColor);

  if (app.setHeaderColor) {
    try {
      app.setHeaderColor(theme.header_bg_color || theme.secondary_bg_color || pageBg);
    } catch {
      // Ignored if not supported
    }
  }
  if (app.setBackgroundColor) {
    try {
      app.setBackgroundColor(pageBg);
    } catch {
      // Ignored if not supported
    }
  }
}

export function applyTelegramSafeArea(app: TelegramWebApp): void {
  const root = document.documentElement.style;
  const safe = app.safeAreaInset ?? {};
  const content = app.contentSafeAreaInset ?? {};

  root.setProperty('--tg-safe-top', `${safe.top ?? 0}px`);
  root.setProperty('--tg-safe-bottom', `${safe.bottom ?? 0}px`);
  root.setProperty('--tg-safe-left', `${safe.left ?? 0}px`);
  root.setProperty('--tg-safe-right', `${safe.right ?? 0}px`);

  root.setProperty('--tg-content-safe-top', `${content.top ?? 0}px`);
  root.setProperty('--tg-content-safe-bottom', `${content.bottom ?? 0}px`);
}