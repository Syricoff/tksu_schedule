import { applyTelegramSafeArea, applyTelegramTheme, getTelegramWebApp, type TelegramWebApp } from './telegram';

export type PlatformName = 'browser' | 'telegram';

export interface Platform {
  readonly name: PlatformName;
  ready(): void;
  setBackHandler(handler: (() => void) | null): void;
  showBackButton(): void;
  hideBackButton(): void;
}

class BrowserPlatform implements Platform {
  readonly name = 'browser' as const;
  ready(): void { document.body.classList.add('browser-mode'); }
  setBackHandler(): void {}
  showBackButton(): void {}
  hideBackButton(): void {}
}

class TelegramPlatform implements Platform {
  readonly name = 'telegram' as const;
  constructor(private readonly app: TelegramWebApp) {}
  ready(): void {
    this.app.ready();
    this.app.expand();
    this.app.requestFullscreen?.();
    document.body.classList.add('miniapp-mode', 'tg-mode');
    applyTelegramTheme(this.app);
    applyTelegramSafeArea(this.app);
    this.app.onEvent('safeAreaChanged', () => applyTelegramSafeArea(this.app));
    this.app.onEvent('contentSafeAreaChanged', () => applyTelegramSafeArea(this.app));
  }
  setBackHandler(handler: (() => void) | null): void {
    if (handler) this.app.BackButton.onClick(handler);
  }
  showBackButton(): void { this.app.BackButton.show(); }
  hideBackButton(): void { this.app.BackButton.hide(); }
}

export function createPlatform(): Platform {
  const app = getTelegramWebApp();
  return app?.initData ? new TelegramPlatform(app) : new BrowserPlatform();
}