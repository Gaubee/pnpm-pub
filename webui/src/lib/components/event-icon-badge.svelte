<script lang="ts" module>
    import type { Component } from "svelte";
    import type { EventStatus } from "$lib/types.js";
</script>

<script lang="ts">
    /**
     * EventIconBadge — the square kind icon (top-left of every EventCard /
     * GroupEventCard) PLUS a status overlay:
     *   - pending: outgoing filled-disc ripples, tinted to MATCH the icon.
     *   - failed / rejected / canceled: a small corner ribbon (red / grey), no text.
     *   - success / expired / action-required: no overlay.
     *
     * The base tile color is supplied by the caller (`tileClass`) since it's
     * driven by the event KIND, not the status (kind and status are
     * independent signals — see EventCard.kindIconClass). `iconColor` carries
     * the SAME color as a CSS value so the pending ripple can match it.
     */
    type Props = {
        icon: Component;
        tileClass: string;
        /** CSS color matching the icon tint (e.g. `var(--success)`). Drives
         *  the pending ripple color so it stays in sync with the icon. */
        iconColor: string;
        status: EventStatus;
    };
    let { icon: Icon, tileClass, iconColor, status }: Props = $props();

    const showRibbon = $derived(
        status === "failed" || status === "rejected" || status === "canceled",
    );
    const showRipple = $derived(status === "pending");
    const ribbonClass = $derived(
        status === "failed" ? "ribbon-failed" : "ribbon-rejected",
    );
</script>

<div class="badge-wrap">
    <div
        class="tile {tileClass} {showRipple ? 'ripple' : ''}"
        style="--icon-color: {iconColor};"
    >
        <Icon class="h-4 w-4" />
        {#if showRipple}
            <!-- Third ripple ring (::before/::after provide the other two). -->
            <span class="ripple-ring" aria-hidden="true"></span>
        {/if}
    </div>
    {#if showRibbon}
        <span class="ribbon {ribbonClass}" aria-hidden="true"></span>
    {/if}
</div>

<style>
    .badge-wrap {
        position: relative;
        display: inline-flex;
        flex-shrink: 0;
    }
    .tile {
        display: flex;
        height: 2rem;
        width: 2rem;
        align-items: center;
        justify-content: center;
        border-radius: 0.375rem;
    }

    /* --- Pending: outgoing filled-disc ripples. Three layers, staggered by
	       animation-delay (0 / 0.66s / 1.33s) so as one disc fades at the
	       perimeter the next emerges from the tile — a continuous outward
	       propagation like a stone dropped in water. Discs only ever travel
	       OUT and dissolve; no suck-back.

	       Color MATCHES the icon (passed via `--ripple-color` from `iconColor`)
	       so a green trust-publish icon ripples green, a blue publish icon
	       ripples blue, etc. Single simple opacity ramp (0 → 0.35 → 0). --- */
    .tile.ripple {
        position: relative;
        /* expose the icon color to the pseudo/child ripple layers */
        --ripple-color: var(--icon-color, var(--brand));
    }
    .tile.ripple::before,
    .tile.ripple::after,
    .tile.ripple > .ripple-ring {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--ripple-color);
        pointer-events: none;
        animation: ripple-out 3s linear infinite;
        mix-blend-mode: hard-light;
        opacity: 0;
    }
    .tile.ripple::after {
        animation-delay: 0.66s;
    }
    .tile.ripple > .ripple-ring {
        animation-delay: 1.33s;
    }
    @keyframes ripple-out {
        0% {
            transform: scale(1);
            opacity: 0;
        }
        20% {
            opacity: 0.2;
        }
        100% {
            transform: scale(2);
            opacity: 0;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .tile.ripple::before,
        .tile.ripple::after,
        .tile.ripple > .ripple-ring {
            animation: none;
            opacity: 0;
        }
    }

    /* --- Failed / Rejected / Canceled: a corner ribbon hanging from the top into the
	       bottom-right. The shape is a rectangle with two diagonal cuts:
	         • (0,0)→(1,1)   — the main diagonal, removes everything below-left
	         • (0.5,0)→(0,0.5) — bevels the top-left corner
	       The surviving polygon is (0.5,0),(1,0),(1,1),(0.25,0.25) — a ribbon
	       fold anchored at the corner, narrowing toward the cut intersection.
	       Semi-transparent so it tints rather than occludes; no text — only
	       color distinguishes failed (red) from rejected (grey). --- */
    .ribbon {
        position: absolute;
        top: 0;
        right: 0;
        width: 50%;
        height: 50%;
        clip-path: polygon(0% 0, 50% 0, 100% 50%, 100% 100%, 25% 25%);
        mix-blend-mode: multiply;
        opacity: 0.6;
    }
    .ribbon-failed {
        background: var(--destructive);
    }
    .ribbon-rejected {
        background: var(--muted-foreground);
    }
</style>
