<!--
  Intent (2026-07-15):
  1. Original user requirement: "开始做这个Windows专属适配工作。注意这个 自绘控件模仿macOS，在左上角".
  2. Render Windows frameless controls only when the native bridge exposes all required commands.
  3. Red hides to tray, yellow minimizes, and green toggles maximize/restore.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import IconX from "@lucide/svelte/icons/x";
  import IconMinus from "@lucide/svelte/icons/minus";
  import IconMaximize2 from "@lucide/svelte/icons/maximize-2";
  import IconMinimize2 from "@lucide/svelte/icons/minimize-2";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import type { OpentrayWindowBridge, OpentrayWindowState } from "../../opentray.d.ts";

  interface FramelessWindowBridge extends OpentrayWindowBridge {
    close: () => Promise<void>;
    minimize: () => Promise<OpentrayWindowState>;
    maximize: () => Promise<OpentrayWindowState>;
    restore: () => Promise<OpentrayWindowState>;
    getWindowState: () => Promise<OpentrayWindowState>;
  }

  let windowBridge = $state<FramelessWindowBridge | null>(null);
  let maximized = $state(false);

  const bridge = (): OpentrayWindowBridge | undefined =>
    navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;

  function supportsFramelessControls(
    candidate: OpentrayWindowBridge | undefined,
  ): candidate is FramelessWindowBridge {
    return (
      candidate?.overlay?.visible !== true &&
      typeof candidate?.close === "function" &&
      typeof candidate?.minimize === "function" &&
      typeof candidate?.maximize === "function" &&
      typeof candidate?.restore === "function" &&
      typeof candidate?.getWindowState === "function"
    );
  }

  function syncState(state: OpentrayWindowState): void {
    maximized = state.maximized;
  }

  onMount(() => {
    const candidate = bridge();
    if (!supportsFramelessControls(candidate)) return;
    windowBridge = candidate;
    void candidate
      .getWindowState()
      .then(syncState)
      .catch(() => {});
  });

  async function closeWindow(): Promise<void> {
    if (!windowBridge) return;
    try {
      await windowBridge.close();
    } catch {
      /* The tray session remains usable if a host command rejects. */
    }
  }

  async function minimizeWindow(): Promise<void> {
    if (!windowBridge) return;
    try {
      syncState(await windowBridge.minimize());
    } catch {
      /* Minimize is a native nicety; leave the page interactive on failure. */
    }
  }

  async function toggleMaximized(): Promise<void> {
    const currentBridge = windowBridge;
    if (!currentBridge) return;
    try {
      const before = await currentBridge.getWindowState();
      const after = before.maximized
        ? await currentBridge.restore()
        : await currentBridge.maximize();
      syncState(after);
    } catch {
      /* Maximize can be unavailable on constrained native windows. */
    }
  }
</script>

{#if windowBridge}
  <div
    class="macos-window-controls no-drag"
    role="group"
    aria-label="Window controls"
    onpointerdown={(event) => event.stopPropagation()}
  >
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            class="window-control close"
            aria-label="Close"
            onclick={closeWindow}
          >
            <IconX />
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Close</Tooltip.Content>
    </Tooltip.Root>

    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            class="window-control minimize"
            aria-label="Minimize"
            onclick={minimizeWindow}
          >
            <IconMinus />
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">Minimize</Tooltip.Content>
    </Tooltip.Root>

    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            class="window-control maximize"
            aria-label={maximized ? "Restore" : "Maximize"}
            onclick={toggleMaximized}
          >
            {#if maximized}
              <IconMinimize2 />
            {:else}
              <IconMaximize2 />
            {/if}
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">{maximized ? "Restore" : "Maximize"}</Tooltip.Content>
    </Tooltip.Root>
  </div>
{/if}

<style>
  .macos-window-controls {
    position: absolute;
    top: 50%;
    left: 12px;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 7px;
    transform: translateY(-50%);
  }
  .window-control {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 50%;
    color: rgb(0 0 0 / 0.58);
    cursor: pointer;
  }
  .window-control :global(svg) {
    width: 8px;
    height: 8px;
    stroke-width: 2.75;
    opacity: 0;
  }
  .macos-window-controls:hover .window-control :global(svg),
  .window-control:focus-visible :global(svg) {
    opacity: 1;
  }
  .window-control:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .close {
    background: #ff5f57;
    border-color: #e0443e;
  }
  .minimize {
    background: #ffbd2e;
    border-color: #dea123;
  }
  .maximize {
    background: #28c840;
    border-color: #1aa22f;
  }
</style>
