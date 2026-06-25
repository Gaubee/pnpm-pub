<script lang="ts">
	import type { HTMLLabelAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, children, ...rest }: HTMLLabelAttributes & { children?: Snippet } = $props();
</script>

<label
	class={cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)}
	{...rest}
>
	{@render children?.()}
</label>
