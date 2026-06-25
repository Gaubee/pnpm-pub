<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { children?: Snippet } = $props();
</script>

<span
	class={cn('flex h-full w-full items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground', className)}
	{...rest}
>
	{@render children?.()}
</span>
