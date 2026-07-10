<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { actions, connect, daemon, activeProfile, pendingEvents } from '$lib/store.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { groupEvents } from '$lib/group-event.js';
	import {
		HOME_WINDOW_SIZE,
		resizeWindow,
	} from '$lib/window-size.js';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import AddProfileDialog from '$lib/components/add-profile-dialog.svelte';
	import SettingsDialog from '$lib/components/settings-dialog.svelte';
	import Island from '$lib/components/island.svelte';
	import { TooltipProvider } from '$lib/components/ui/tooltip/index.js';
	import { activity, bridgeDaemonToast, showActivity, clearActivity, type IslandActivity } from '$lib/notify.js';
	import WindowDragRegion from '$lib/components/window-drag-region.svelte';
	import { initI18n } from '$lib/i18n.js';
	import { initWindowVisibility } from '$lib/window-visibility.js';
	import type { PubEvent } from '$lib/types.js';
	import type { EventGroup } from '$lib/group-event.js';
	import { _ } from 'svelte-i18n';
	import IconArrowRight from '@lucide/svelte/icons/arrow-right';
	import IconPublish from '@lucide/svelte/icons/upload';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconShieldMinus from '@lucide/svelte/icons/shield-minus';
	import IconPackage from '@lucide/svelte/icons/package';

	let { children } = $props();

	initI18n();

	onMount(() => {
		// Establish the long-lived daemon WS connection (Chapter 4.4.3).
		const stopWindowVisibility = initWindowVisibility();
		connect();
		return () => stopWindowVisibility();
	});

	// Bridge daemon toasts (auth result, errors, pending-event created, …) into
	// the Dynamic Island. `bridgeDaemonToast` dedupes by the toast id.
	$effect(() => {
		bridgeDaemonToast($daemon.toast);
	});

	/**
	 * Reflect the newest pending GROUP in the Dynamic Island as a sticky,
	 * expandable activity. iOS Dynamic Island is a single slot, so we surface
	 * only the newest pending group (from `groupEvents($pendingEvents)`); other
	 * pending items are signalled by the sidebar badge.
	 *
	 * The summary reflects the group's kind (e.g. "Trusted Publishing · 3") so
	 * the user sees WHAT the activity is; the expanded detail shows a progress
	 * bar of resolved/total members. When there is nothing pending the slot is
	 * cleared. We re-run when the slot becomes empty (`$activity`), so a
	 * transient activity (toast/download) that clears itself restores this one.
	 */
	const groupKindIcon = (kind: EventGroup['kind']): typeof IconPublish => {
		if (kind === 'trusted-publishing') return IconShield;
		if (kind === 'trusted-publishing-remove') return IconShieldMinus;
		if (kind === 'publish') return IconPublish;
		return IconPackage;
	};

	/** A standalone pending event's compact summary: VERB + object, so the user
	 *  sees what's happening to what at a glance (e.g. "Publishing @scope/pkg@1.2.3"). */
	const standaloneSummary = (e: PubEvent): string => {
		const p = e.payload;
		if (p?.kind === 'publish') return $_('island.publishing', { values: { target: `${p.data.target.name}@${p.data.target.version}` } });
		if (p?.kind === 'unpublish') return $_('island.unpublishing', { values: { target: `${p.data.name}@${p.data.version}` } });
		if (p?.kind === 'configure-trust') {
			const k = p.data.action === 'add' ? 'island.addingTrust' : p.data.action === 'update' ? 'island.updatingTrust' : 'island.removingTrust';
			return $_(k);
		}
		if (p?.kind === 'create-placeholder') return $_('island.reserving', { values: { name: p.data.name } });
		if (p?.kind === 'recursive-publish') return $_('island.publishingN', { values: { count: p.data.targets.length } });
		if (p?.kind === 'refresh-token') return $_('island.refreshingToken');
		return e.kind;
	};
	/** The KEY-INFO detail line for a standalone event (no fake progress bar —
	 *  a single event is binary pending→done). Shows what matters per kind. */
	const standaloneDetail = (e: PubEvent): string => {
		const p = e.payload;
		if (p?.kind === 'publish') {
			const repo = p.data.target.repository;
			if (repo) return repo;
			return p.data.source.path.split('/').pop() ?? p.data.source.path;
		}
		if (p?.kind === 'unpublish') return $_('island.irreversible');
		if (p?.kind === 'configure-trust') {
			const t = p.data.target;
			return t.repository ? `${t.name} · ${t.repository}` : t.name;
		}
		if (p?.kind === 'create-placeholder') return $_('island.placeholder');
		if (p?.kind === 'recursive-publish') {
			return p.data.source.path.split('/').pop() ?? p.data.source.path;
		}
		if (p?.kind === 'refresh-token') return p.data.username;
		return '';
	};

	/** Group batch summary: kind label + count (e.g. "Trusted Publishing · 3"). */
	const groupSummary = (g: EventGroup): string => {
		const key =
			g.kind === 'trusted-publishing' ? 'groupEvent.kindTrustedPublishing'
			: g.kind === 'trusted-publishing-remove' ? 'groupEvent.kindRemoveTrustedPublishing'
			: g.kind === 'publish' ? 'groupEvent.kindPublish'
			: 'groupEvent.kindMixed';
		return $_(key, { values: { count: g.events.length } });
	};
	let pendingActivityId: number | null = null;
	$effect(() => {
		const topGroup = groupEvents($pendingEvents)[0];
		// Whose activity is in the slot right now? If a transient (download/toast)
		// owns it (id ≠ ours), leave it alone — it'll clear itself and this effect
		// re-runs (it depends on `$activity`) to restore ours.
		const slot = $activity;
		const transientOwnsSlot = slot !== null && slot.id !== pendingActivityId;

		if (topGroup && !transientOwnsSlot) {
			// GROUP (multi-member batch) → real progress (resolved/total).
			// STANDALONE → verb summary + key-info text (no fake progress bar).
			const isGroup = topGroup.isGroup;
			const summary = isGroup ? groupSummary(topGroup) : standaloneSummary(topGroup.latest);
			const detail = isGroup
				? (() => {
						const members = topGroup.events;
						const total = members.length;
						const resolved = members.filter((e) => e.status !== 'pending').length;
						return {
							kind: 'progress' as const,
							progress: total ? resolved / total : 0,
							label: $_('groupEvent.progress', { values: { done: resolved, total } }),
						};
					})()
				: { kind: 'text' as const, text: standaloneDetail(topGroup.latest) };
			// Always (re)show so progress/summary stay in sync as members resolve.
			// showActivity replaces the current activity (same effect when ours is
			// already showing) and returns a fresh id we track.
			pendingActivityId = showActivity({
				icon: groupKindIcon(topGroup.kind),
				// trusted-publishing → success (green), removal → warning
				// (orange), mirroring the card accent.
				tone: topGroup.kind === 'trusted-publishing'
					? 'success'
					: topGroup.kind === 'trusted-publishing-remove'
						? 'warning'
						: 'info',
				summary,
				detail,
				primaryAction: {
					icon: IconArrowRight,
					label: `View ${summary}`,
					run: () => { void focusEventCard(topGroup.id); },
				},
			});
			return;
		}
		// No pending group → clear ours if we still own the slot.
		if (!topGroup && pendingActivityId !== null && !transientOwnsSlot) {
			clearActivity(pendingActivityId);
			pendingActivityId = null;
		}
	});

	/**
	 * Navigate to /active-events and smoothly scroll the GROUP card
	 * (`#event-{targetId}`) into view.
	 *
	 * Two things can be late:
	 *   1. the element itself (page mounts async, `surfaceGroups` derives from
	 *      WS state that lags) — we wait via MutationObserver.
	 *   2. its LAYOUT (flip/fade-in transitions, list reordering as members
	 *      resolve, GroupEventCard accordion open + trusted-publishing fetch)
	 *      — the card's rect keeps moving for a few frames after it appears.
	 * We therefore wait not just for the node but for its bounding rect to stop
	 * changing (sampled per frame) before smooth-scrolling to the settled pos.
	 */
	async function focusEventCard(targetId: string): Promise<void> {
		const selector = `event-${targetId}`;
		const find = () => document.getElementById(selector);

		if (page.url.pathname !== '/active-events') {
			await goto('/active-events');
		}
		let el = find() ?? (await waitForElement(selector, 3000));
		if (!(el instanceof HTMLElement)) return;
		// Wait for layout to settle (flip/fade/reorder/accordion), then scroll.
		await waitForLayoutStable(el);
		// Re-resolve in case the node was replaced during the settle window.
		el = find() ?? el;
		if (el instanceof HTMLElement) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	/**
	 * Resolve with the element matching `id` once it exists in the DOM, or null
	 * after `timeoutMs`. Watches document mutations so a late-mounted card is
	 * caught the instant it's inserted (no busy-polling).
	 */
	function waitForElement(id: string, timeoutMs: number): Promise<HTMLElement | null> {
		return new Promise((resolve) => {
			const existing = document.getElementById(id);
			if (existing) return resolve(existing);
			let settled = false;
			const finish = (val: HTMLElement | null) => {
				if (settled) return;
				settled = true;
				observer.disconnect();
				clearTimeout(deadline);
				resolve(val);
			};
			const observer = new MutationObserver(() => {
				const el = document.getElementById(id);
				if (el) finish(el);
			});
			observer.observe(document.body, { childList: true, subtree: true });
			const deadline = setTimeout(() => finish(document.getElementById(id)), timeoutMs);
		});
	}

	/**
	 * Resolve once `el`'s geometry stops changing across frames — i.e. the
	 * surrounding layout has settled (enter/flip transitions done, reorders and
	 * async height changes applied). Samples top + height per animation frame;
	 * declares stable after `STABLE_FRAMES` consecutive identical samples, with a
	 * hard budget so it never waits forever. Falls back to a minimum dwell so a
	 * truly-stable-on-arrival card still gives transitions time to finish.
	 */
	function waitForLayoutStable(el: HTMLElement): Promise<void> {
		const STABLE_FRAMES = 3;
		const BUDGET_MS = 1200;
		const MIN_MS = 120; // let enter/flip (≈200ms) at least begin to settle
		return new Promise((resolve) => {
			const start = performance.now();
			let lastTop = -Infinity;
			let lastHeight = -Infinity;
			let stable = 0;
			let raf = 0;
			const tickFrame = () => {
				const r = el.getBoundingClientRect();
				const moved = Math.abs(r.top - lastTop) > 0.5 || Math.abs(r.height - lastHeight) > 0.5;
				lastTop = r.top;
				lastHeight = r.height;
				stable = moved ? 0 : stable + 1;
				const elapsed = performance.now() - start;
				if ((stable >= STABLE_FRAMES && elapsed >= MIN_MS) || elapsed >= BUDGET_MS) {
					resolve();
					return;
				}
				raf = requestAnimationFrame(tickFrame);
			};
			raf = requestAnimationFrame(tickFrame);
		});
	}



	/**
	 * First-profile gate: when the daemon has sent the authoritative profiles
	 * frame and it is empty, there is no formal content to show except the
	 * onboarding route. The shell only switches to onboarding chrome once the
	 * route is actually `/add-profile`; otherwise a stale Events child would
	 * render inside the wrong immersive shell for one frame or longer.
	 */
	const needsOnboarding = $derived($daemon.profilesLoaded && $daemon.profiles.length === 0);
	const isAddProfileRoute = $derived(page.url.pathname === '/add-profile');
	const isOnboarding = $derived(needsOnboarding && isAddProfileRoute);

	// `/add-profile` owns an in-progress credential form, so tell the daemon to
	// suppress blur-driven auto-hide while this route is active. The pathname is
	// a route fact, distinct from persistent preferences and pending events.
	$effect(() => {
		const connected = $daemon.connected;
		const pathname = page.url.pathname;
		if (!connected) return;
		actions.setTrayRoute(pathname);
	});

	$effect(() => {
		if (!needsOnboarding || isAddProfileRoute) return;
		goto(`/add-profile${window.location.hash}`, { replaceState: true });
	});

	/**
	 * Re-auth gate: a profile exists but the active one is NOT authenticated
	 * (token expired / password changed / never finished auth). Route the user
	 * to that profile's detail page, which hosts the inline re-auth card
	 * (password pre-filled from keychain, user may overwrite it). The card
	 * guards navigation while a renewal is in progress. We do NOT redirect when
	 * the user is already on that page (avoids a loop), or when no profile is
	 * resolvable (onboarding still owns that case below).
	 */
	const needsReauth = $derived(
		$daemon.profilesLoaded &&
			$daemon.profiles.length > 0 &&
			($activeProfile?.authStatus ?? 'unauthenticated') !== 'authenticated',
	);
	$effect(() => {
		if (!needsReauth) return;
		const target = $activeProfile?.username;
		if (!target) return;
		// Already viewing the expired profile's detail page → let the card handle it.
		const detailPath = `/profiles/${encodeURIComponent(target)}`;
		if (page.url.pathname === detailPath) return;
		goto(`${detailPath}${window.location.hash}`, { replaceState: true });
	});

	/**
	 * Per-route default window geometry. Add-profile measures its own content
	 * with ResizeObserver and falls back locally; every other route keeps the
	 * landscape hub geometry here.
	 */
	$effect(() => {
		const connected = $daemon.connected;
		const pathname = page.url.pathname;
		void connected; // re-run when the bridge becomes available
		if (!connected) return;
		if (pathname === '/add-profile') return;
		resizeWindow(HOME_WINDOW_SIZE);
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<!-- mode-watcher applies the .dark class based on system preference (Chapter 6.1.3). -->
<ModeWatcher></ModeWatcher>

<TooltipProvider>
{#if isOnboarding}
	<!--
		Onboarding shell: no sidebar / no floating-card chrome. The translucent
		root background lets the native window blur read through, and the route
		page renders its own centred card. Children = the /add-profile page.
	-->
		<div class="flex h-screen w-screen flex-col overflow-hidden bg-background/60 text-foreground backdrop-blur-xl">
			<!-- Keep the titlebar drag affordance even on the onboarding page.
			     Onboarding shows language + theme (user may need to switch language
			     before authenticating); the main shell shows theme + Settings. -->
			<WindowDragRegion variant="onboarding" />
			<main class="min-h-0 overflow-auto">
				{@render children?.()}
			</main>
		</div>
{:else}
	<!--
		Glass layering (overlay-window-controls window style):
		The opentray window paints a native gaussian-blur material behind the page
		(semantic/blur). The root carries a single LOW-opacity translucent fill so
		that native blur shows through everywhere. The sidebar is transparent
		(inherits this root fill); the main content is a FLOATING rounded card that
		layers its own more-opaque translucent fill on top, with internal scroll.
	-->
	<div class="flex h-screen w-screen flex-col overflow-hidden bg-background/60 text-foreground backdrop-blur-xl">
			<!-- Overlay-chrome titlebar: native drag via startAppRegionDrag (Chapter 6.1.3). -->
			<WindowDragRegion variant="main" />

		<div class="flex min-h-0 flex-1">
			<!-- Sidebar-07 shell: transparent — lets the root blur read through. -->
			<AppSidebar />

			<!--
				Main content floats as a single rounded card inside the window: an outer
				spacer + an inner translucent surface that owns its own scroll. Route
				cross-fades come from the View Transitions API (Chapter 4.4.2).
			-->
			<main class="flex min-w-0 flex-1 flex-col p-2">
				<div class="min-h-0 flex-1 overflow-y-auto rounded-xl bg-background/85 shadow-lg ring-1 ring-border/50 backdrop-blur-md">
					{@render children?.()}
				</div>
			</main>
		</div>
	</div>
{/if}

<!-- Single instance of the Add Profile dialog (driven by the `ui` store). -->
<AddProfileDialog />

<!-- Single instance of the Settings dialog (general / preferences / export). -->
<SettingsDialog />

<!-- Global notification surface (Dynamic Island), centred in the titlebar. -->
<Island />
</TooltipProvider>
