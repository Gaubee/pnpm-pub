/**
 * Orthogonal intents (2026-07-17; original user request: make pnpm-pub frameless match webview-control):
 * 1. Select the OpenTray 0.14.3 comparator with native side/bottom resize insets and a visible-border-only top edge.
 * 2. Keep the private OpenTray switch behind one pnpm-pub-owned compatibility boundary.
 * 3. Preserve an explicit production-topology override for rollback and visual A/B testing.
 */

export const OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV =
  "OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR";
export const PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY_ENV =
  "PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY";

export type OpenTrayWindowsHostTopology = "production" | "native-material-comparator";

/**
 * Project the pnpm-pub Windows host policy into the environment inherited by
 * OpenTray's broker. Remove this bridge once the public production topology
 * provides the accepted native frameless resize frame and top-edge projection directly.
 */
export function configureOpenTrayWindowsHostTopology(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): OpenTrayWindowsHostTopology {
  if (platform !== "win32") return "production";

  if (environment[PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY_ENV] === "production") {
    delete environment[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV];
    return "production";
  }

  environment[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV] = "1";
  return "native-material-comparator";
}
