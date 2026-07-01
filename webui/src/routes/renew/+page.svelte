<script lang="ts">
	/**
	 * Renew — surfaced when an event resolves as `expired` or `action-required`.
	 * Reuses the onboarding flow: provide NPM password to mint a fresh token,
	 * while the daemon keeps the credential pair in keychain for later renewal.
	 * Falls back to manual paste like add-profile.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import { errorToMessage } from '$lib/error-projection.js';
	import { parseTokenApplyResponse } from '$lib/rest-response.js';
	import { getRenewProjection, toRenewReason } from '$lib/renew-projection.js';
	import { activeProfile } from '$lib/store.js';
	import { apiFetch } from '$lib/api-fetch.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { _ } from 'svelte-i18n';

	let password = $state('');
	let manualToken = $state('');
	let totpSecret = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let needsManual = $state(false);
	// Default to the currently active profile's username (Chapter 6.2.4 renew).
	let username = $state($activeProfile?.username ?? '');

	const reason = $derived(toRenewReason(page.url.searchParams.get('reason')));
	const projection = $derived(getRenewProjection(reason));

	async function renew(): Promise<void> {
		busy = true;
		error = null;
		needsManual = false;
		try {
			const res = await apiFetch('/api/renew', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					username,
					password,
					manualToken: manualToken || undefined,
					totpSecret: totpSecret || undefined,
				}),
			});
			const json = parseTokenApplyResponse(await res.json());
			if (!json) {
				error = $_('renew.invalidDaemon');
				return;
			}
			if (json.ok) {
				manualToken = '';
				totpSecret = '';
				goto('/active-events');
				return;
			}
			if (json.needsManualToken) {
				needsManual = true;
				error = json.error ?? $_('renew.silentRefused');
			} else {
				error = json.error ?? projection.defaultError;
			}
		} catch (err) {
			error = errorToMessage(err);
		} finally {
			busy = false;
			password = '';
		}
	}
</script>

<svelte:head><title>{projection.documentTitle}</title></svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-5 p-6">
	<a href="/active-events" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
	<IconArrowLeft class="h-3.5 w-3.5" /> {$_('common.back')}
	</a>
	<header>
		<h1 class="text-lg font-semibold tracking-tight">{projection.heading}</h1>
		<p class="text-xs text-muted-foreground">{projection.intro}</p>
	</header>
	<Card>
		<CardHeader>
			<CardTitle>{$_('renew.cardTitle')}</CardTitle>
			<CardDescription>{$_('renew.cardIntro')}</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3">
			<div class="space-y-1.5">
		<Label for="u">{$_('renew.username')}</Label>
		<Input id="u" bind:value={username} placeholder={$_('addProfile.usernamePlaceholder')} />
			</div>
			{#if !needsManual}
				<div class="space-y-1.5">
					<Label for="p">{$_('renew.password')}</Label>
				<Input id="p" type="password" bind:value={password} />
				</div>
			{:else}
				<div class="space-y-1.5">
					<Label for="m">{$_('renew.manualToken')}</Label>
					<Input id="m" bind:value={manualToken} placeholder={$_('renew.manualTokenPlaceholder')} />
				</div>
			{/if}
			<div class="space-y-1.5">
				<Label for="t">{$_('renew.totpSecret')}</Label>
				<Input id="t" bind:value={totpSecret} placeholder={$_('renew.totpPlaceholder')} />
				</div>
				{#if error}<p class="text-xs text-destructive">{error}</p>{/if}
				<Button
					variant="brand"
					class="w-full"
					disabled={busy || !username || (!needsManual && !password) || (needsManual && !manualToken)}
					onclick={renew}
				>
					{busy ? projection.busyLabel : projection.submitLabel}
				</Button>
		</CardContent>
	</Card>
</div>
