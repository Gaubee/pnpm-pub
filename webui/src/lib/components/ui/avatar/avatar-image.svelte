<script lang="ts">
	import type { HTMLImgAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		class: className = undefined,
		src = undefined,
		alt = undefined,
		children,
		...rest
	}: HTMLImgAttributes & { src?: string; children?: Snippet } = $props();

	let failed = $state(false);
</script>

{#if src && !failed}
	<img
		{src}
		{alt}
		class={cn('aspect-square h-full w-full object-cover', className)}
		onerror={() => (failed = true)}
		{...rest}
	/>
{:else}
	{@render children?.()}
{/if}
