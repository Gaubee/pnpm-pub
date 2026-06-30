<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		class: className = undefined,
		children,
		...rest
	}: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
</script>

<!--
	InputGroup — a flex container that visually fuses an <Input> with one or two
	<InputGroupAddon> suffixes/prefixes into a single bordered control (shadcn
	svelte pattern). The inner <Input> drops its own border (data attribute) so
	only the group shows an outline.
-->
<div
	data-slot="input-group"
	class={cn(
		'flex h-9 w-full items-center overflow-hidden rounded-md border border-input bg-background text-sm shadow-sm',
		'focus-within:ring-2 focus-within:ring-ring',
		className,
	)}
	{...rest}
>
	{@render children?.()}
</div>
