/**
 * Page-owned tray window visibility animation.
 *
 * The daemon projects only platform facts: visibility, pin state, active-event
 * presence, and whether auto-close is currently authorized. This module owns
 * the visual timeline with one invisible DOM element using WAAPI, then mirrors
 * the computed opacity to the native OpenTray window and derives the countdown
 * number from the same animation currentTime.
 */
import { browser } from "$app/environment";
import { get } from "svelte/store";
import { actions, daemon, setWindowAutoCloseCountdown, type DaemonState } from "$lib/store.js";

const ENTER_DURATION_MS = 1000;
const EXIT_DURATION_MS = 6000;
const IOS_ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const OPACITY_EPSILON = 0.002;

type Mode = "idle" | "entering" | "exiting";

const bridge = (): Navigator["opentrayWindow"] =>
  navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function countdownFromExitTime(currentTime: number): number {
  const remainingMs = Math.max(0, EXIT_DURATION_MS - currentTime);
  return Math.max(0, Math.ceil(remainingMs / 1000) - 1);
}

class WindowVisibilityController {
  private readonly source: HTMLElement;
  private animation: Animation | null = null;
  private mode: Mode = "idle";
  private queuedExit = false;
  private currentOpacity = 1;
  private lastNativeOpacity = Number.NaN;
  private lastVisibility: DaemonState["windowVisibility"] = "hidden";
  private raf: number | null = null;
  private stopStore: (() => void) | null = null;

  constructor() {
    this.source = document.createElement("div");
    this.source.setAttribute("aria-hidden", "true");
    Object.assign(this.source.style, {
      position: "fixed",
      left: "-9999px",
      top: "-9999px",
      width: "1px",
      height: "1px",
      pointerEvents: "none",
      opacity: "1",
    });
    document.body.appendChild(this.source);
  }

  start(): void {
    if (this.stopStore) return;
    this.stopStore = daemon.subscribe((state) => this.onDaemonState(state));
  }

  stop(): void {
    this.stopStore?.();
    this.stopStore = null;
    this.stopAnimation();
    setWindowAutoCloseCountdown(null);
    this.source.remove();
  }

  private onDaemonState(state: DaemonState): void {
    const becameShown = this.lastVisibility === "hidden" && state.windowVisibility === "shown";
    this.lastVisibility = state.windowVisibility;

    if (state.windowVisibility === "hidden") {
      this.queuedExit = false;
      this.stopAnimation();
      this.mode = "idle";
      setWindowAutoCloseCountdown(null);
      return;
    }

    if (becameShown) {
      this.startEnter(0);
      if (state.exitRequested) this.queuedExit = true;
      return;
    }

    if (state.exitRequested) {
      if (this.mode === "entering") {
        this.queuedExit = true;
        return;
      }
      if (this.mode !== "exiting") {
        if (this.currentOpacity < 1 - OPACITY_EPSILON) {
          this.queuedExit = true;
          this.startEnter(this.currentOpacity);
        } else {
          this.startExit();
        }
      }
      return;
    }

    this.queuedExit = false;
    if (this.mode === "exiting") {
      this.startEnter(this.readOpacity());
    } else if (this.mode === "idle" && this.currentOpacity < 1 - OPACITY_EPSILON) {
      this.startEnter(this.currentOpacity);
    }
  }

  private startEnter(fromOpacity: number): void {
    const from = clampOpacity(fromOpacity);
    this.stopAnimation();
    this.mode = "entering";
    setWindowAutoCloseCountdown(null);
    this.setSourceOpacity(from);
    this.applyNativeOpacity(from);
    const animation = this.source.animate([{ opacity: String(from) }, { opacity: "1" }], {
      duration: ENTER_DURATION_MS,
      easing: IOS_ENTER_EASING,
      fill: "forwards",
    });
    this.animation = animation;
    this.mirrorFrames();
    animation.finished.then(
      () => {
        if (this.animation !== animation) return;
        this.mode = "idle";
        this.setSourceOpacity(1);
        this.applyNativeOpacity(1);
        this.animation = null;
        if (this.queuedExit && get(daemon).exitRequested) {
          this.queuedExit = false;
          this.startExit();
        }
      },
      () => {
        /* cancelled by a newer timeline */
      },
    );
  }

  private startExit(): void {
    this.stopAnimation();
    this.mode = "exiting";
    this.queuedExit = false;
    const from = clampOpacity(this.currentOpacity);
    this.setSourceOpacity(from);
    this.applyNativeOpacity(from);
    setWindowAutoCloseCountdown(5);
    const animation = this.source.animate(
      [
        { opacity: String(from), offset: 0, easing: SPRING_EASING },
        { opacity: "0.8", offset: 1 / 6, easing: SPRING_EASING },
        { opacity: "0.9", offset: 2 / 6, easing: SPRING_EASING },
        { opacity: "0.5", offset: 3 / 6, easing: SPRING_EASING },
        { opacity: "0.7", offset: 4 / 6, easing: SPRING_EASING },
        { opacity: "0", offset: 1 },
      ],
      { duration: EXIT_DURATION_MS, fill: "forwards" },
    );
    this.animation = animation;
    this.mirrorFrames();
    animation.finished.then(
      () => {
        if (this.animation !== animation) return;
        this.mode = "idle";
        this.setSourceOpacity(0);
        this.applyNativeOpacity(0);
        this.animation = null;
        setWindowAutoCloseCountdown(null);
        if (get(daemon).exitRequested) actions.completeAutoClose();
      },
      () => {
        /* cancelled by focus, pin, active events, or a new visibility frame */
      },
    );
  }

  private stopAnimation(): void {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    if (!this.animation) return;
    const opacity = this.readOpacity();
    this.animation.cancel();
    this.animation = null;
    this.setSourceOpacity(opacity);
  }

  private mirrorFrames(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.animation) {
        this.raf = null;
        return;
      }
      const opacity = this.readOpacity();
      this.applyNativeOpacity(opacity);
      if (this.mode === "exiting") {
        const currentTime =
          typeof this.animation.currentTime === "number" ? this.animation.currentTime : 0;
        setWindowAutoCloseCountdown(countdownFromExitTime(currentTime));
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private readOpacity(): number {
    const parsed = Number.parseFloat(getComputedStyle(this.source).opacity);
    this.currentOpacity = clampOpacity(parsed);
    return this.currentOpacity;
  }

  private setSourceOpacity(opacity: number): void {
    this.currentOpacity = clampOpacity(opacity);
    this.source.style.opacity = String(this.currentOpacity);
  }

  private applyNativeOpacity(opacity: number): void {
    const next = clampOpacity(opacity);
    if (Math.abs(next - this.lastNativeOpacity) < OPACITY_EPSILON) return;
    this.lastNativeOpacity = next;
    const win = bridge();
    try {
      void win?.setStyle?.({ opacity: next })?.catch(() => {});
    } catch {
      /* native opacity is a host nicety; browser fallback remains usable */
    }
  }
}

let activeController: WindowVisibilityController | null = null;

/** Install the singleton page-owned native-window visibility controller. */
export function initWindowVisibility(): () => void {
  if (!browser) return () => {};
  if (!activeController) {
    activeController = new WindowVisibilityController();
    activeController.start();
  }
  return () => {
    activeController?.stop();
    activeController = null;
  };
}
