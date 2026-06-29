import { describe, expect, it } from 'vitest';
import { resolveDevTrayMode } from '../../src/daemon/dev-mode.js';

describe('resolveDevTrayMode', () => {
  it('Scenario: Given Linux dev startup, When the tray policy resolves, Then dev runs headless', () => {
    const mode = resolveDevTrayMode({}, 'linux');

    expect(mode).toEqual({
      withTray: false,
      strictTrayMount: false,
      notice: 'native tray is unavailable on linux; running headless',
    });
  });

  it('Scenario: Given macOS dev startup, When the tray policy resolves, Then dev tries the native tray by default', () => {
    const mode = resolveDevTrayMode({}, 'darwin');

    expect(mode).toEqual({
      withTray: true,
      strictTrayMount: false,
      notice: null,
    });
  });

  it('Scenario: Given explicit headless dev startup, When the tray policy resolves, Then tray mounting stays disabled', () => {
    const mode = resolveDevTrayMode(
      { PNPM_PUB_DEV_NO_TRAY: '1', PNPM_PUB_DEV_STRICT_TRAY: '1' },
      'win32',
    );

    expect(mode).toEqual({
      withTray: false,
      strictTrayMount: false,
      notice: 'native tray disabled by PNPM_PUB_DEV_NO_TRAY=1; running headless',
    });
  });
});
