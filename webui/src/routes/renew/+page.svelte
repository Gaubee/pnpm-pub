<script lang="ts">
	/**
	 * Renew — surfaced when an event resolves as `expired` (Chapter 6.2.4).
	 * Reuses the onboarding flow: provide NPM password to silently re-apply a
	 * token (read-after-burn). Falls back to manual paste like add-profile.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import { readWebToken, activeProfile } from '$lib/store.js';
	import { goto } from '$app/navigation';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';

	let password = $state('');
	let manualToken = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let needsManual = $state(false);
	// Default to the currently active profile's username (Chapter 6.2.4 renew).
	let username = $state($activeProfile?.username ?? '');

	async function renew(): Promise<void> {
		busy = true;
		error = null;
		needsManual = false;
		try {
			const res = await fetch('/api/renew', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${readWebToken()}` },
				body: JSON.stringify({ username, password, manualToken: manualToken || undefined, totpSecret: '' }),
			});
			const json = (await res.json()) as { ok: boolean; needsManualToken?: boolean; error?: string };
			if (json.ok) {
				goto('/');
				return;
			}
			if (json.needsManualToken) {
				needsManual = true;
				error = json.error ?? 'NPM refused the silent token apply.';
			} else {
				error = json.error ?? 'Renew failed.';
			}
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
			password = '';
		}
	}
</script>

<svelte:head><title>Renew Token · pnpm-pub</title></svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-5 p-6">
	<a href="/" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
		<IconArrowLeft class="h-3.5 w-3.5" /> Back
	</a>
	<header>
		<h1 class="text-lg font-semibold tracking-tight">Renew Token</h1>
		<p class="text-xs text-muted-foreground">The current token has expired. Re-apply to continue publishing.</p>
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
			{#if error}<p class="text-xs text-destructive">{error}</p>{/if}
			<Button variant="brand" class="w-full" disabled={busy || !username || (!password && !manualToken)} onclick={renew}>
				{busy ? 'Renewing…' : 'Renew token'}
			</Button>
		</CardContent>
	</Card>
</div>
