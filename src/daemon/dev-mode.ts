/**
 * Dev startup policy for the daemon.
 *
 * `pnpm dev` should prefer the native tray on platforms that can actually host
 * it, but it must stay usable when the tray surface is unavailable. That means
 * Linux and explicit no-tray runs fall back to the browser-facing WebUI instead
 * of crashing the process.
 */
export interface DevTrayMode {
  withTray: boolean;
  strictTrayMount: boolean;
  notice: string | null;
}

export function resolveDevTrayMode(
  env: Partial<Pick<NodeJS.ProcessEnv, "PNPM_PUB_DEV_NO_TRAY" | "PNPM_PUB_DEV_STRICT_TRAY">>,
  platform: NodeJS.Platform,
): DevTrayMode {
  const trayDisabledByEnv = env.PNPM_PUB_DEV_NO_TRAY === "1";
  const supportsNativeTray = platform === "darwin" || platform === "win32";
  const withTray = supportsNativeTray && !trayDisabledByEnv;
  const strictTrayMount = withTray && env.PNPM_PUB_DEV_STRICT_TRAY === "1";

  if (trayDisabledByEnv) {
    return {
      withTray,
      strictTrayMount,
      notice: "native tray disabled by PNPM_PUB_DEV_NO_TRAY=1; running headless",
    };
  }

  if (!supportsNativeTray) {
    return {
      withTray,
      strictTrayMount,
      notice: `native tray is unavailable on ${platform}; running headless`,
    };
  }

  return {
    withTray,
    strictTrayMount,
    notice: null,
  };
}
