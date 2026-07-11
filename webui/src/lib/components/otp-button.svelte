<script lang="ts">
  /**
   * OtpButton — Profile-detail header control that fetches the live 2FA code
   * on demand and shows it in a hover tooltip with a countdown ring.
   *
   * - The button itself is static: two states only — default (key icon) and
   *   copied (check icon). It never animates or counts down.
   * - Tooltip open is pointer-driven: pointerenter pins `open` to true,
   *   pointerout drops it to false. This keeps the tooltip pinned through a
   *   click-to-copy (aided by disableCloseOnTriggerClick).
   * - The OTP is only fetched/subscribed while the tooltip is open — a
   *   `$effect` reacting to `open` starts the countdown + periodic refetch on
   *   open and tears them down (and clears the in-memory code) on close.
   * - The countdown ring lives inside the tooltip (not on the button). The
   *   ring's center always shows the remaining-seconds digit (floored, ≤9);
   *   the arc depletes over the 30s TOTP window and turns warning-colored in
   *   the final 10s. The 6-digit code sits beside the ring in a grid.
   * - Click → copies the OTP; the button briefly shows a check icon.
   * - When no TOTP secret is stored (`configured: false`), the button is
   *   disabled and the tooltip explains why.
   *
   * The 6-digit code is generated daemon-side (Chapter 3.1: the TOTP secret
   * never leaves daemon memory). The browser drives the ring locally off the
   * daemon's reported `epochMs`/`remainingSec`, re-fetching on each window
   * rollover (and periodically for clock-drift correction) so the displayed
   * code stays accurate.
   */
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { getRpcClient } from "$lib/store.js";
  import { _ } from "svelte-i18n";
  import IconKey from "@lucide/svelte/icons/rotate-ccw-key";
  import IconCheck from "@lucide/svelte/icons/check";

  let { username }: { username: string } = $props();

  const STEP = 30; // RFC 6238 TOTP step (seconds)

  // ----- tooltip open state drives fetching / countdown -----
  /**
   * Tooltip open state, driven by pointer events on the button. We pin it to
   * `true` on pointerenter so the tooltip stays open through a click-to-copy
   * (paired with `disableCloseOnTriggerClick` on the Root), and drop it to
   * `false` on pointerout so it closes when the pointer leaves. Keeping this a
   * concrete boolean (not `undefined`) avoids Svelte's
   * `props_invalid_value` error from `bind:open` against a defaulted prop.
   */
  let open = $state(false);

  // ----- daemon-sourced state -----
  let code = $state<string | null>(null);
  /** Daemon `remainingSec` measured at `anchorMs` (daemon wall-clock). */
  let anchorRemaining = $state(STEP);
  let anchorMs = $state<number | null>(null);
  let configured = $state<boolean | null>(null);
  let loadError = $state<string | null>(null);

  // ----- locally-driven countdown -----
  /** Live seconds left in the current window, derived from the daemon anchor. */
  let remaining = $state(STEP);

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let refetchHandle: ReturnType<typeof setInterval> | null = null;
  let lastWindow = Math.floor(Date.now() / 1000 / STEP);

  /** Ring geometry — a compact ring sized to sit beside the code. */
  const R = 13;
  const CIRC = 2 * Math.PI * R;

  async function fetchOtp(): Promise<void> {
    try {
      const res = await getRpcClient()?.profile.otp({ username });
      if (!res) return;
      if (res.ok && res.code) {
        code = res.code;
        anchorRemaining = res.remainingSec ?? STEP;
        anchorMs = res.epochMs ?? Date.now();
        configured = true;
        loadError = null;
      } else if (res.configured === false) {
        configured = false;
        code = null;
        loadError = null;
      } else {
        loadError = res.error ?? $_("profile.otpLoadError");
      }
    } catch {
      loadError = $_("profile.otpLoadError");
    }
  }

  /** Recompute the live remaining seconds from the daemon anchor. */
  function tick(): void {
    if (anchorMs === null) return;
    const elapsedSec = (Date.now() - anchorMs) / 1000;
    let r = anchorRemaining - elapsedSec;
    // Modulo into (0, STEP] so the value wraps cleanly at the 30s boundary.
    r = ((r % STEP) + STEP) % STEP;
    if (r === 0) r = STEP;
    remaining = r;

    const win = Math.floor(Date.now() / 1000 / STEP);
    if (win !== lastWindow) {
      // New TOTP window → cached code is stale; refresh it.
      lastWindow = win;
      void fetchOtp();
    }
  }

  function startCountdown(): void {
    if (tickHandle) return;
    tickHandle = setInterval(tick, 250);
    // Periodic drift correction: re-sync with the daemon mid-window so a
    // skewed local clock can't drift the ring away from the real code.
    refetchHandle = setInterval(() => void fetchOtp(), 10_000);
  }

  function stopCountdown(): void {
    if (tickHandle) clearInterval(tickHandle);
    if (refetchHandle) clearInterval(refetchHandle);
    tickHandle = null;
    refetchHandle = null;
  }

  // Fetch + countdown only while the tooltip is open (open === true). When
  // closed (open === false) we stop the timers and clear the in-memory code
  // so no OTP lingers off-screen; the next open re-fetches a fresh one.
  $effect(() => {
    if (!open) {
      stopCountdown();
      code = null;
      anchorMs = null;
      return;
    }
    if (configured === false) return; // nothing to fetch / count down
    lastWindow = Math.floor(Date.now() / 1000 / STEP);
    remaining = STEP;
    void fetchOtp();
    startCountdown();
  });

  // Reset daemon state when the profile changes.
  $effect(() => {
    void username;
    code = null;
    configured = null;
    loadError = null;
    anchorMs = null;
    remaining = STEP;
  });

  async function onclick(): Promise<void> {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copied = false;
        copiedTimer = null;
      }, 1200);
    } catch {
      /* clipboard unavailable (permissions / non-secure context) */
    }
  }

  // ----- derived view state -----
  /** Remaining whole seconds shown at the ring center (floored; can be 0–30). */
  const countdownDigit = $derived(Math.max(0, Math.floor(remaining)));
  /** Whether we're in the final 10s (ring turns warning-colored). */
  const urgent = $derived(remaining <= 10);
  const progress = $derived(Math.max(0, Math.min(1, remaining / STEP)));
  const dashOffset = $derived(CIRC * (1 - progress));
  const disabled = $derived(configured === false);
  const ariaLabel = $derived(
    copied
      ? $_("profile.otpCopied")
      : disabled
        ? $_("profile.otpNotConfigured")
        : $_("profile.otpCopy"),
  );
  const codeDisplay = $derived(code ? `${code.slice(0, 3)} ${code.slice(3)}` : null);
</script>

<!-- `disableCloseOnTriggerClick` keeps the tooltip open when the button is
     clicked to copy — combined with pointerenter/pointerout pinning `open`,
     the OTP stays visible through the copy interaction. -->
<Tooltip.Root bind:open disableCloseOnTriggerClick>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        type="button"
        variant="outline"
        size="icon"
        {disabled}
        aria-label={ariaLabel}
        {onclick}
        onpointerenter={() => (open = true)}
        onpointerout={() => (open = false)}
        class="shrink-0"
      >
        {#if copied}
          <IconCheck class="size-4 text-success" />
        {:else}
          <IconKey class="size-4" />
        {/if}
      </Button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content side="bottom" class="grid gap-1.5 px-3 py-2.5">
    <!-- mini-title -->
    <span class="text-[10px] font-medium uppercase tracking-wide text-background/70">
      {$_("profile.otp")}
    </span>
    {#if disabled}
      <span class="text-xs font-normal text-background/80">{$_("profile.otpNotConfigured")}</span>
    {:else if codeDisplay}
      <!-- ring | code — side by side via grid-cols-[auto_1fr] -->
      <div class="grid grid-cols-[auto_1fr] items-center gap-2.5">
        <!-- Countdown ring. The arc depletes over the 30s TOTP window; the
				     center always shows the remaining-seconds digit (floored, ≤9),
				     and the arc turns warning-colored in the final 10s. -->
        <div class="relative grid size-8 place-items-center">
          <svg class="absolute inset-0 size-full -rotate-90" viewBox="0 0 32 32" aria-hidden="true">
            <circle
              cx="16"
              cy="16"
              r={R}
              fill="none"
              class="stroke-background/20"
              stroke-width="2"
            />
            <circle
              cx="16"
              cy="16"
              r={R}
              fill="none"
              class={urgent ? "stroke-warning" : "stroke-background"}
              stroke-width="2"
              stroke-linecap="round"
              stroke-dasharray={CIRC}
              stroke-dashoffset={dashOffset}
            />
          </svg>
          <span class="relative text-[11px] font-semibold tabular-nums">{countdownDigit}</span>
        </div>
        <!-- The 6-digit code. Centered in its grid cell, never overlapped. -->
        <span class="text-center font-mono text-base font-semibold tracking-[0.2em]"
          >{codeDisplay}</span
        >
      </div>
    {:else if loadError}
      <span class="text-xs font-normal text-background/80">{loadError}</span>
    {:else}
      <span class="text-xs font-normal text-background/80">{$_("common.loading")}</span>
    {/if}
  </Tooltip.Content>
</Tooltip.Root>
