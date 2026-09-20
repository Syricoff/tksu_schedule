import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlatform, type Platform } from './platform';
import { applyTelegramSafeArea, applyTelegramTheme, type TelegramWebApp } from './telegram';

describe('platform layer', () => {
  let mockBodyClasses: Set<string>;
  let mockStyles: Map<string, string>;

  beforeEach(() => {
    mockBodyClasses = new Set();
    mockStyles = new Map();

    const mockDocument = {
      body: {
        classList: {
          add: (...cls: string[]) => cls.forEach((c) => mockBodyClasses.add(c)),
          remove: (...cls: string[]) => cls.forEach((c) => mockBodyClasses.delete(c)),
          contains: (c: string) => mockBodyClasses.has(c),
        },
      },
      documentElement: {
        style: {
          setProperty: (k: string, v: string) => mockStyles.set(k, v),
          getPropertyValue: (k: string) => mockStyles.get(k) ?? '',
        },
      },
    };

    const mockWindow = {
      open: vi.fn(),
      document: mockDocument,
    };

    // @ts-expect-error test mock
    globalThis.window = mockWindow;
    // @ts-expect-error test mock
    globalThis.document = mockDocument;
  });

  it('creates BrowserPlatform when Telegram is not present', () => {
    const platform = createPlatform();
    expect(platform.name).toBe('browser');
    expect(platform.isTelegram).toBe(false);

    platform.ready();
    expect(mockBodyClasses.has('browser-mode')).toBe(true);
    expect(mockBodyClasses.has('miniapp-mode')).toBe(false);
  });

  it('creates TelegramPlatform when Telegram WebApp is present with platform or initData', () => {
    const mockTg: Partial<TelegramWebApp> = {
      platform: 'ios',
      initData: 'query_id=123',
      ready: vi.fn(),
      expand: vi.fn(),
      requestFullscreen: vi.fn(),
      disableVerticalSwipes: vi.fn(),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      BackButton: {
        isVisible: false,
        show: vi.fn(),
        hide: vi.fn(),
        onClick: vi.fn(),
        offClick: vi.fn(),
      },
      HapticFeedback: {
        selectionChanged: vi.fn(),
        impactOccurred: vi.fn(),
        notificationOccurred: vi.fn(),
      },
      openLink: vi.fn(),
      themeParams: {
        bg_color: '#1c1c1e',
        secondary_bg_color: '#2c2c2e',
        text_color: '#ffffff',
        button_color: '#0a84ff',
      },
      safeAreaInset: { top: 44, bottom: 34, left: 0, right: 0 },
    };

    (globalThis.window as Window & { Telegram?: { WebApp: TelegramWebApp } }).Telegram = {
      WebApp: mockTg as TelegramWebApp,
    };

    const platform: Platform = createPlatform();
    expect(platform.name).toBe('telegram');
    expect(platform.isTelegram).toBe(true);

    platform.ready();
    expect(mockTg.ready).toHaveBeenCalled();
    expect(mockTg.expand).toHaveBeenCalled();
    expect(mockTg.requestFullscreen).toHaveBeenCalled();
    expect(mockTg.disableVerticalSwipes).toHaveBeenCalled();
    expect(mockBodyClasses.has('miniapp-mode')).toBe(true);
    expect(mockBodyClasses.has('tg-mode')).toBe(true);
    expect(mockBodyClasses.has('browser-mode')).toBe(false);

    // Haptics
    platform.haptic('selection');
    expect(mockTg.HapticFeedback?.selectionChanged).toHaveBeenCalled();
    platform.haptic('impact-light');
    expect(mockTg.HapticFeedback?.impactOccurred).toHaveBeenCalledWith('light');
    platform.haptic('success');
    expect(mockTg.HapticFeedback?.notificationOccurred).toHaveBeenCalledWith('success');

    // BackButton
    const backFn = vi.fn();
    platform.setBackHandler(backFn);
    expect(mockTg.BackButton!.onClick).toHaveBeenCalledWith(backFn);
    platform.showBackButton();
    expect(mockTg.BackButton!.show).toHaveBeenCalled();
    platform.hideBackButton();
    expect(mockTg.BackButton!.hide).toHaveBeenCalled();

    // External link
    platform.openExternalLink('https://example.com');
    expect(mockTg.openLink).toHaveBeenCalledWith('https://example.com');
  });

  it('applies Telegram theme and safe areas to document root', () => {
    const mockTg: Partial<TelegramWebApp> = {
      colorScheme: 'dark',
      themeParams: {
        bg_color: '#18222d',
        secondary_bg_color: '#131b24',
        text_color: '#ffffff',
        hint_color: '#708499',
        button_color: '#2b9fe3',
        section_separator_color: '#212d3b',
      },
      safeAreaInset: { top: 48, bottom: 24, left: 10, right: 10 },
      contentSafeAreaInset: { top: 12, bottom: 8, left: 0, right: 0 },
      setHeaderColor: vi.fn(),
      setBackgroundColor: vi.fn(),
    };

    applyTelegramTheme(mockTg as TelegramWebApp);
    applyTelegramSafeArea(mockTg as TelegramWebApp);

    expect(mockStyles.get('--tg-bg')).toBe('#131b24');
    expect(mockStyles.get('--tg-text')).toBe('#ffffff');
    expect(mockStyles.get('--tg-accent')).toBe('#2b9fe3');
    expect(mockStyles.get('--tg-safe-top')).toBe('48px');
    expect(mockStyles.get('--tg-safe-bottom')).toBe('24px');
    expect(mockStyles.get('--tg-content-safe-top')).toBe('12px');
    expect(mockTg.setHeaderColor).toHaveBeenCalled();
    expect(mockTg.setBackgroundColor).toHaveBeenCalled();
  });
});
