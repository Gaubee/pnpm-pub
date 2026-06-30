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
	InputGroupAddon — a suffix/prefix slot inside <InputGroup>. Holds an
	icon-button (e.g. the TOTP scan button). Shrinks-to-fit; the inner input
	consumes the remaining width.
-->
<div
	data-slot="input-group-addon"
	class={cn('flex h-full items-center px-2 text-muted-foreground', className)}
	{...rest}
>
	{@render children?.()}
</div>
