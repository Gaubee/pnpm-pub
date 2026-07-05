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
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
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
	}: {
		eventId: string;
		groupId?: string;
		config?: TrustedPublisherCreateConfig;
		currentConfig?: TrustedPublisherConfig;
		repositoryHint?: string;
		disabled?: boolean;
		valid?: boolean;
	} = $props();
</script>

<div class="space-y-2">
	<div class="flex justify-end">
		<ButtonGroup>
			<Button variant={trustFormMode === 'compact' ? 'brand' : 'outline'} size="sm" class="px-2 text-[11px]" onclick={() => setTrustFormMode('compact')}>{$_('trustedPublishing.formModeCompact')}</Button>
			<Button variant={trustFormMode === 'full' ? 'brand' : 'outline'} size="sm" class="px-2 text-[11px]" onclick={() => setTrustFormMode('full')}>{$_('trustedPublishing.formModeFull')}</Button>
		</ButtonGroup>
	</div>
	<TrustedPublishingDraftForm
		{eventId}
		{groupId}
		{config}
		{currentConfig}
		{repositoryHint}
		mode={trustFormMode}
		{disabled}
		bind:valid
	/>
</div>
