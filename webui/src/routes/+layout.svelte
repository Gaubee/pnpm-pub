<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { connect, daemon, pendingEvents } from '$lib/store.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import Toaster from '$lib/components/toaster.svelte';

	let { children } = $props();

	onMount(() => {
		// Establish the long-lived daemon WS connection (Chapter 4.4.3).
		connect();
	});

	// Chapter 4.4.3: when a pending publish arrives, auto-route to the
	// dedicated /publish-confirm surface (unless we're already there).
	$effect(() => {
		const pending = $pendingEvents;
		const here = page.url.pathname;
		if (pending.length > 0 && here !== '/publish-confirm') {
			goto('/publish-confirm');
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<!-- mode-watcher applies the .dark class based on system preference (Chapter 6.1.3). -->
<ModeWatcher></ModeWatcher>

<div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
	<!-- Native frameless drag handle (Chapter 6.1.3). -->
	<div class="drag-region h-8 shrink-0 border-b border-border bg-sidebar"></div>

	<div class="flex min-h-0 flex-1">
		<!-- Sidebar-07 shell: navigation + bottom-left profile switcher. -->
		<AppSidebar />

		<!--
			Main content area. Cross-fade transitions between routes are driven by
			the View Transitions API (Chapter 4.4.2) — see layout.css
			`@view-transition { navigation: auto; }` and the `::view-transition-*`
			keyframes.
		-->
		<main class="min-w-0 flex-1 overflow-y-auto">
			{@render children?.()}
		</main>
	</div>
</div>

<Toaster store={daemon} />
