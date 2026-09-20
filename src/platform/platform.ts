import {
  applyTelegramSafeArea,
  applyTelegramTheme,
  getTelegramWebApp,
  isTelegramEnvironment,
  type TelegramCloudStorage,
  type TelegramWebApp,
} from './telegram';

export type PlatformName = 'browser' | 'telegram';

export type HapticType =
  | 'selection'
  | 'impact-light'
  | 'impact-medium'
  | 'success'
  | 'warning'
  | 'error';

export interface PlatformUser {
  id: number;
  firstName: string;
  username?: string;
}

export interface Platform {
  readonly name: PlatformName;
  readonly isTelegram: boolean;
  ready(): void;
  setBackHandler(handler: (() => void) | null): void;
  showBackButton(): void;
  hideBackButton(): void;
  haptic(type: HapticType): void;
  openExternalLink(url: string): void;
  getCloudStorage(): TelegramCloudStorage | null;
  getUser(): PlatformUser | null;
}

class BrowserPlatform implements Platform {
  readonly name = 'browser' as const;
  readonly isTelegram = false;

  ready(): void {
    document.body.classList.add('browser-mode');
  }

  setBackHandler(): void {}
  showBackButton(): void {}
  hideBackButton(): void {}
  haptic(): void {}

  openExternalLink(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  getCloudStorage(): null {
    return null;
  }

  getUser(): null {
    return null;
  }
}

class TelegramPlatform implements Platform {
  readonly name = 'telegram' as const;
  readonly isTelegram = true;
  private currentBackHandler: (() => void) | null = null;

  constructor(private readonly app: TelegramWebApp) {}

  ready(): void {
    this.app.ready();
    this.app.expand();
    this.app.requestFullscreen?.();
    this.app.disableVerticalSwipes?.();

    document.body.classList.remove('browser-mode');
    document.body.classList.add('miniapp-mode', 'tg-mode');

    applyTelegramTheme(this.app);
    applyTelegramSafeArea(this.app);

    this.app.onEvent('themeChanged', () => applyTelegramTheme(this.app));
    this.app.onEvent('safeAreaChanged', () => applyTelegramSafeArea(this.app));
    this.app.onEvent('contentSafeAreaChanged', () => applyTelegramSafeArea(this.app));
  }

  setBackHandler(handler: (() => void) | null): void {
    if (this.currentBackHandler) {
      try {
        this.app.BackButton.offClick(this.currentBackHandler);
      } catch {
        // Safe fallback
      }
    }
    this.currentBackHandler = handler;
    if (handler) {
      this.app.BackButton.onClick(handler);
    }
  }

  showBackButton(): void {
    this.app.BackButton.show();
  }

  hideBackButton(): void {
    this.app.BackButton.hide();
  }

  haptic(type: HapticType): void {
    const feedback = this.app.HapticFeedback;
    if (!feedback) return;
    try {
      switch (type) {
        case 'selection':
          feedback.selectionChanged();
          break;
        case 'impact-light':
          feedback.impactOccurred('light');
          break;
        case 'impact-medium':
          feedback.impactOccurred('medium');
          break;
        case 'success':
          feedback.notificationOccurred('success');
          break;
        case 'warning':
          feedback.notificationOccurred('warning');
          break;
        case 'error':
          feedback.notificationOccurred('error');
          break;
      }
    } catch {
      // Haptics not supported on client
    }
  }

  openExternalLink(url: string): void {
    if (this.app.openLink) {
      this.app.openLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  getCloudStorage(): TelegramCloudStorage | null {
    return this.app.CloudStorage ?? null;
  }

  getUser(): PlatformUser | null {
    const user = this.app.initDataUnsafe?.user;
    if (!user) return null;
    return {
      id: user.id,
      firstName: user.first_name,
      username: user.username,
    };
  }
}

let platformInstance: Platform | null = null;

export function createPlatform(): Platform {
  if (isTelegramEnvironment()) {
    const app = getTelegramWebApp();
    if (app) return new TelegramPlatform(app);
  }
  return new BrowserPlatform();
}

export function getPlatform(): Platform {
  if (!platformInstance) {
    platformInstance = createPlatform();
  } else if (!platformInstance.isTelegram && isTelegramEnvironment()) {
    const app = getTelegramWebApp();
    if (app) {
      platformInstance = new TelegramPlatform(app);
    }
  }
  return platformInstance;
}