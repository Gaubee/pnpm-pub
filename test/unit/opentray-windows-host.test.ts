/**
 * Orthogonal intents (2026-07-17; original user request: make pnpm-pub frameless match webview-control):
 * 1. Lock the default Windows comparator projection.
 * 2. Lock the explicit production rollback path.
 * 3. Prove non-Windows environments remain untouched.
 */

import { describe, expect, it } from "vite-plus/test";
import {
  configureOpenTrayWindowsHostTopology,
  OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV,
  PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY_ENV,
} from "../../src/daemon/opentray-windows-host.js";

describe("configureOpenTrayWindowsHostTopology", () => {
  it("selects the accepted comparator before a Windows broker starts", () => {
    const environment: Record<string, string | undefined> = {};

    expect(configureOpenTrayWindowsHostTopology(environment, "win32")).toBe(
      "native-material-comparator",
    );
    expect(environment[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV]).toBe("1");
  });

  it("supports an explicit production-topology rollback", () => {
    const environment: Record<string, string | undefined> = {
      [PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY_ENV]: "production",
      [OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV]: "1",
    };

    expect(configureOpenTrayWindowsHostTopology(environment, "win32")).toBe("production");
    expect(environment[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV]).toBeUndefined();
  });

  it("does not project Windows policy on another platform", () => {
    const environment: Record<string, string | undefined> = {};

    expect(configureOpenTrayWindowsHostTopology(environment, "darwin")).toBe("production");
    expect(environment[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV]).toBeUndefined();
  });
});
