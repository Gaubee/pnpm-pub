<script lang="ts">
	/**
	 * Root route is a thin redirect to the default Events surface.
	 * The Events Hub is split into /active-events (default) and /event-history.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		goto('/active-events', { replaceState: true });
	});
</script>

<div class="p-6 text-xs text-muted-foreground">…</div>
