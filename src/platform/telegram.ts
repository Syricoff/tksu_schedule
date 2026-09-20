export interface TelegramWebApp {
  initData?: string;
  themeParams?: Record<string, string>;
  safeAreaInset?: Partial<Record<'top' | 'bottom' | 'left' | 'right', number>>;
  contentSafeAreaInset?: Partial<Record<'top' | 'bottom' | 'left' | 'right', number>>;
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  onEvent(event: string, handler: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(handler: () => void): void };
}

export function getTelegramWebApp(): TelegramWebApp | null {
  const telegram = (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram;
  return telegram?.WebApp ?? null;
}

export function applyTelegramTheme(app: TelegramWebApp): void {
  const theme = app.themeParams ?? {};
  const root = document.documentElement.style;
  if (theme.bg_color) root.setProperty('--tg-bg', theme.bg_color);
  if (theme.secondary_bg_color) root.setProperty('--tg-card-bg', theme.secondary_bg_color);
  if (theme.text_color) root.setProperty('--tg-text', theme.text_color);
  if (theme.hint_color) root.setProperty('--tg-muted', theme.hint_color);
  if (theme.button_color) root.setProperty('--tg-accent', theme.button_color);
}

export function applyTelegramSafeArea(app: TelegramWebApp): void {
  const root = document.documentElement.style;
  const safe = app.safeAreaInset ?? {};
  const content = app.contentSafeAreaInset ?? {};
  root.setProperty('--tg-safe-top', `${safe.top ?? 0}px`);
  root.setProperty('--tg-safe-bottom', `${safe.bottom ?? 0}px`);
  root.setProperty('--tg-content-safe-top', `${content.top ?? 0}px`);
  root.setProperty('--tg-content-safe-bottom', `${content.bottom ?? 0}px`);
}