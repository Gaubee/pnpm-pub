<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let { class: className = undefined, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
</script>

<div class={cn('p-5 pt-0', className)} {...rest}>
	{@render children?.()}
</div>
