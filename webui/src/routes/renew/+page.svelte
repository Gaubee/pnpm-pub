<script lang="ts">
	/**
	 * Renew — surfaced when an event resolves as `expired` or `action-required`.
	 * Reuses the onboarding flow: provide NPM password to silently re-apply a
	 * token (read-after-burn). Falls back to manual paste like add-profile.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import { errorToMessage } from '$lib/error-projection.js';
	import { parseTokenApplyResponse } from '$lib/rest-response.js';
	import { getRenewProjection, toRenewReason } from '$lib/renew-projection.js';
	import { readWebToken, activeProfile } from '$lib/store.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';

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
			const res = await fetch('/api/renew', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${readWebToken()}` },
				body: JSON.stringify({
					username,
					password,
					manualToken: manualToken || undefined,
					totpSecret: totpSecret || undefined,
				}),
			});
			const json = parseTokenApplyResponse(await res.json());
			if (!json) {
				error = 'Invalid daemon response.';
				return;
			}
			if (json.ok) {
				manualToken = '';
				totpSecret = '';
				goto('/');
				return;
			}
			if (json.needsManualToken) {
				needsManual = true;
				error = json.error ?? 'NPM refused the silent token apply.';
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
	<a href="/" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
		<IconArrowLeft class="h-3.5 w-3.5" /> Back
	</a>
	<header>
		<h1 class="text-lg font-semibold tracking-tight">{projection.heading}</h1>
		<p class="text-xs text-muted-foreground">{projection.intro}</p>
	</header>
	<Card>
		<CardHeader>
			<CardTitle>Re-apply credentials</CardTitle>
			<CardDescription>Provide your NPM password to silently mint a fresh token.</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3">
			<div class="space-y-1.5">
				<Label for="u">Username</Label>
				<Input id="u" bind:value={username} placeholder="john_doe" />
			</div>
			{#if !needsManual}
				<div class="space-y-1.5">
					<Label for="p">Password</Label>
					<Input id="p" type="password" bind:value={password} />
				</div>
			{:else}
				<div class="space-y-1.5">
					<Label for="m">Manual token (fallback)</Label>
					<Input id="m" bind:value={manualToken} placeholder="npm_..." />
				</div>
			{/if}
			<div class="space-y-1.5">
				<Label for="t">TOTP secret (if missing from keychain)</Label>
				<Input id="t" bind:value={totpSecret} placeholder="JBSWY3DPEHPK3PXP" />
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
