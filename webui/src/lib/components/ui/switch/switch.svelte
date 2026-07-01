<script lang="ts">
	import { Switch as SwitchPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		class: className = undefined,
		checked = $bindable(false),
		...rest
	}: SwitchPrimitive.RootProps = $props();
</script>

<SwitchPrimitive.Root
	bind:checked
	data-slot="switch"
	class={cn(
		'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
		'disabled:cursor-not-allowed disabled:opacity-50',
		checked ? 'bg-brand' : 'bg-input',
		className,
	)}
	{...rest}
>
	<SwitchPrimitive.Thumb
		class={cn(
			'pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
			checked ? 'translate-x-4' : 'translate-x-0',
		)}
	/>
</SwitchPrimitive.Root>
