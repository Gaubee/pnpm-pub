<script lang="ts">
	import type { Writable } from 'svelte/store';
	import { fly } from 'svelte/transition';
	import IconInfo from '@lucide/svelte/icons/info';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconAlert from '@lucide/svelte/icons/triangle-alert';

	import type { DaemonState } from '$lib/store.js';

	type Toast = NonNullable<DaemonState['toast']>;

	let { store }: { store: Writable<DaemonState> } = $props();

	let current = $state<Toast | null>(null);
	let lastId = $state(0);
	let timer: ReturnType<typeof setTimeout> | null = null;

	// Subscribe to the store and surface toasts (Chapter 6.2).
	$effect(() => {
		const unsub = store.subscribe((s) => {
			if (s.toast && s.toast.id !== lastId) {
				current = s.toast;
				lastId = s.toast.id;
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => (current = null), 3500);
			}
		});
		return () => unsub();
	});

	const IconCmp = $derived(
		current?.level === 'success' ? IconCheck : current?.level === 'error' ? IconAlert : IconInfo,
	);
	const tone = $derived(
		current?.level === 'success'
			? 'border-success/40 bg-success/10 text-foreground'
			: current?.level === 'error'
				? 'border-destructive/40 bg-destructive/10 text-foreground'
				: 'border-border bg-popover text-foreground',
	);
</script>

{#if current}
	<div class="pointer-events-none fixed bottom-4 right-4 z-50">
		<div transition:fly={{ y: 20, duration: 200 }} class="pointer-events-auto flex items-center gap-2.5 rounded-md border px-3.5 py-2.5 text-sm shadow-lg {tone}">
			<IconCmp class="h-4 w-4 shrink-0" />
			<span>{current.message}</span>
		</div>
	</div>
{/if}
