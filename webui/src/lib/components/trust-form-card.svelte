<script lang="ts">
	/**
	 * TrustFormCard — a thin wrapper around `TrustedPublishingDraftForm` that
	 * adds the compact/full mode toggle.
	 *
	 * Shared by:
	 *   - EventCardBody (single configure-trust event, custom-editable)
	 *   - GroupEventCard (the default form that fans out to group members)
	 *
	 * The mode toggle (compact ↔ full) persists to the backend preferences
	 * store under `trustedPublishing.formMode`, so it's shared across every
	 * instance — flipping it on one card flips it everywhere.
	 *
	 * `bind:valid` and `bind:dirty` forward the form's validity / dirty state up
	 * the chain. `resetToSeed()` (an exported instance method) re-exposes the
	 * inner form's reset so a parent (dialog footer) can restore edits.
	 */
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import TrustedPublishingDraftForm from '$lib/components/trusted-publishing-draft-form.svelte';
	import { actions, daemon } from '$lib/store.js';
	import { _ } from 'svelte-i18n';
	import { z } from 'zod';
	import type { TrustedPublisherConfig, TrustedPublisherCreateConfig } from '$lib/types.js';

	const TRUST_FORM_MODE_KEY = 'trustedPublishing.formMode';
	const TrustFormModeSchema = z.enum(['full', 'compact']);
	const trustFormMode = $derived.by((): 'full' | 'compact' => {
		const result = TrustFormModeSchema.safeParse($daemon.preferences.values?.[TRUST_FORM_MODE_KEY]);
		return result.success ? result.data : 'full';
	});
	function setTrustFormMode(mode: 'full' | 'compact'): void {
		actions.setPreferenceValue(TRUST_FORM_MODE_KEY, mode);
	}

	let {
		eventId,
		groupId = undefined,
		config = undefined,
		currentConfig = undefined,
		repositoryHint = '',
		disabled = false,
		valid = $bindable(false),
		dirty = $bindable(false),
		stagedConfig = $bindable<TrustedPublisherCreateConfig | null>(null),
		deferSubmit = false,
	}: {
		eventId: string;
		groupId?: string;
		config?: TrustedPublisherCreateConfig;
		currentConfig?: TrustedPublisherConfig;
		repositoryHint?: string;
		disabled?: boolean;
		valid?: boolean;
		/** Whether the user has edited the form away from its seed. */
		dirty?: boolean;
		/** Local-staged config (deferSubmit mode). See TrustedPublishingDraftForm. */
		stagedConfig?: TrustedPublisherCreateConfig | null;
		deferSubmit?: boolean;
	} = $props();

	// Ref to the inner form so its exported `resetToSeed` can be re-exposed.
	let formRef: { resetToSeed: () => void } | null = $state(null);

	/** Restore the form + daemon draft to the initial seed. No-op until the
	 *  inner form has mounted / captured a seed. */
	export function resetToSeed(): void {
		formRef?.resetToSeed();
	}
</script>

<div class="space-y-2">
	<div class="flex justify-end">
		<ToggleGroup.Root
			type="single"
			value={trustFormMode}
			onValueChange={(v) => v && setTrustFormMode(v as 'full' | 'compact')}
			variant="brand"
			size="sm"
		>
			<ToggleGroup.Item value="compact" class="px-2 text-[11px]">{$_('trustedPublishing.formModeCompact')}</ToggleGroup.Item>
			<ToggleGroup.Item value="full" class="px-2 text-[11px]">{$_('trustedPublishing.formModeFull')}</ToggleGroup.Item>
		</ToggleGroup.Root>
	</div>
	<TrustedPublishingDraftForm
		bind:this={formRef}
		{eventId}
		{groupId}
		{config}
		{currentConfig}
		{repositoryHint}
		mode={trustFormMode}
		{disabled}
		bind:valid
		bind:dirty
		bind:stagedConfig
		{deferSubmit}
	/>
</div>
