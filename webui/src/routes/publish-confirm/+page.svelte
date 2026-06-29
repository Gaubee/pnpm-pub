<script lang="ts">
	/**
	 * /publish-confirm — the dedicated confirmation surface (Chapter 4.4.2/4.4.3).
	 *
	 * The spec requires a distinct route that the store auto-navigates to when a
	 * pending publish arrives. This page focuses exclusively on the pending
	 * publish card (Confirm / Reject), mirroring event-card.svelte. The Events
	 * home still shows the inline card as a fallback/summary.
	 */
	import { pendingEvents } from '$lib/store.js';
	import EventCard from '$lib/components/event-card.svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { _ } from 'svelte-i18n';

	// If nothing is pending, this page has nothing to confirm → back to Events.
	$effect(() => {
		if (browser && $pendingEvents.length === 0) goto('/');
	});
</script>

<svelte:head><title>{$_('publishConfirm.title')}</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-5 p-6">
	<header>
		<a href="/" class="text-xs text-muted-foreground hover:text-foreground">{$_('publishConfirm.back')}</a>
		<h1 class="mt-2 text-lg font-semibold tracking-tight">{$_('publishConfirm.heading')}</h1>
		<p class="text-xs text-muted-foreground">{$_('publishConfirm.intro')}</p>
	</header>

	{#if $pendingEvents.length === 0}
		<div class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
			{$_('publishConfirm.empty')}
		</div>
	{:else}
		{#each $pendingEvents as event (event.id)}
			<EventCard {event} />
		{/each}
	{/if}
</div>
