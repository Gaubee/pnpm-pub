<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { connect, daemon, activeProfile } from '$lib/store.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		HOME_WINDOW_SIZE,
		resizeWindow,
	} from '$lib/window-size.js';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import AddProfileDialog from '$lib/components/add-profile-dialog.svelte';
	import Island from '$lib/components/island.svelte';
	import { TooltipProvider } from '$lib/components/ui/tooltip/index.js';
	import { bridgeDaemonToast } from '$lib/notify.js';
	import WindowDragRegion from '$lib/components/window-drag-region.svelte';
	import { initI18n } from '$lib/i18n.js';
	import { initWindowVisibility } from '$lib/window-visibility.js';

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
	 * First-profile gate: when the daemon has sent the authoritative profiles
	 * frame and it is empty, there is no formal content to show except the
	 * onboarding route. The shell only switches to onboarding chrome once the
	 * route is actually `/add-profile`; otherwise a stale Events child would
	 * render inside the wrong immersive shell for one frame or longer.
	 */
	const needsOnboarding = $derived($daemon.profilesLoaded && $daemon.profiles.length === 0);
	const isAddProfileRoute = $derived(page.url.pathname === '/add-profile');
	const isOnboarding = $derived(needsOnboarding && isAddProfileRoute);

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
		<!-- Keep the titlebar drag affordance even on the onboarding page. -->
		<WindowDragRegion />
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
		<WindowDragRegion />

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

<!-- Global notification surface (Dynamic Island), centred in the titlebar. -->
<Island />
</TooltipProvider>
