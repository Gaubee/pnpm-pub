<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, value = $bindable(), ...rest }: HTMLInputAttributes & { value?: string | number } = $props();
</script>

<input
	bind:value
	class={cn(
		'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors',
		'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
		'disabled:cursor-not-allowed disabled:opacity-50',
		// When nested inside an <InputGroup>, drop the input's own chrome — the
		// group owns the border/ring/shadow so the fused control looks unified.
		'[&[data-slot=input-group]_&]:border-0 [&[data-slot=input-group]_&]:shadow-none [&[data-slot=input-group]_&]:ring-0 [&[data-slot=input-group]_&]:focus-visible:ring-0',
		className,
	)}
	{...rest}
/>
