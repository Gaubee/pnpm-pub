<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { children?: Snippet } = $props();
</script>

<span
	class={cn('relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full', className)}
	{...rest}
>
	{@render children?.()}
</span>
