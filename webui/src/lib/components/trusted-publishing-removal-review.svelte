<script lang="ts">
	/** Per-config removal review shared by standalone EventCards and group member dialogs. */
	import type {
		RemovalDecision,
		RemovalDecisions,
		TrustedPublisherRegistryConfig,
	} from '$lib/types.js';
	import type { TrustedPublishingStatus } from '$lib/hooks/use-trusted-publishing.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import BrandIcon from '$lib/components/brand-icon.svelte';
	import TrustedPublishingReadonly from '$lib/components/trusted-publishing-readonly.svelte';
	import { providerBrandId, providerLabelKey } from '$lib/trusted-publishing.js';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconRefresh from '@lucide/svelte/icons/refresh-cw';
	import IconShieldCheck from '@lucide/svelte/icons/shield-check';
	import IconShieldCog from '@lucide/svelte/icons/shield-cog-corner';
	import IconShieldMinus from '@lucide/svelte/icons/shield-minus';
	import { _ } from 'svelte-i18n';

	let {
		configs,
		decisions,
		status,
		disabled = false,
		onDecision,
		onRetry,
	}: {
		configs: readonly TrustedPublisherRegistryConfig[];
		decisions: RemovalDecisions;
		status: TrustedPublishingStatus;
		disabled?: boolean;
		onDecision: (configId: string, decision: RemovalDecision) => void;
		onRetry?: () => void;
	} = $props();
</script>

<div class="space-y-2">
	<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
		<IconShieldCog class="h-4 w-4 text-brand" />
		{$_('trustedPublishing.currentConfigs')}
	</div>

	{#if status === 'idle' || status === 'loading'}
		<div class="flex items-center gap-1.5 border-y border-border py-3 text-[11px] text-muted-foreground">
			<IconLoader class="h-3 w-3 animate-spin" />
			{$_('trustedPublishing.loading')}
		</div>
	{:else if status === 'error'}
		<div class="flex items-center justify-between gap-2 border-y border-border py-2 text-[11px] text-destructive">
			<span>{$_('trustedPublishing.loadFailed')}</span>
			{#if onRetry}
				<Button variant="outline" size="icon-sm" onclick={onRetry} aria-label={$_('eventCard.retry')}>
					<IconRefresh class="h-3.5 w-3.5" />
				</Button>
			{/if}
		</div>
	{:else if configs.length === 0}
		<div class="border-y border-border py-3 text-[11px] text-muted-foreground">
			{$_('trustedPublishing.notConfigured')}
		</div>
	{:else}
		<div class="divide-y divide-border border-y border-border">
			{#each configs as config (config.id)}
				{@const decision = decisions[config.id]}
				<div class="space-y-2 py-2.5">
					<div class="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-foreground">
						<BrandIcon id={providerBrandId(config.type)} class="h-3 w-3" />
						<span class="min-w-0 flex-1 truncate">{$_(providerLabelKey(config.type))}</span>
						<ToggleGroup.Root
							type="single"
							value={decision}
							onValueChange={(v) => v && onDecision(config.id, v as RemovalDecision)}
							size="sm"
							class="items-center"
						>
							<ToggleGroup.Item
								value="keep"
								variant="brand"
								class="h-6 px-2 text-[11px]"
								{disabled}
							>
								<IconShieldCheck class="h-3 w-3" />
								{$_('groupEvent.keep')}
							</ToggleGroup.Item>
							<ToggleGroup.Item
								value="remove"
								variant="destructive"
								class="h-6 px-2 text-[11px]"
								{disabled}
							>
								<IconShieldMinus class="h-3 w-3" />
								{$_('groupEvent.remove')}
							</ToggleGroup.Item>
						</ToggleGroup.Root>
					</div>
					<TrustedPublishingReadonly {config} mode="multiline" />
				</div>
			{/each}
		</div>
	{/if}
</div>
