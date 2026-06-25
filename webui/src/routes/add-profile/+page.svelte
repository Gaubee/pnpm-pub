<script lang="ts">
	/**
	 * Add Profile — automated token apply with graceful fallback (Chapter 8.1).
	 * The password is sent to the daemon which burns it after the NPM exchange.
	 * If NPM silently rejects (rate-limit/captcha) we surface a manual-paste box.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import { daemon, readWebToken } from '$lib/store.js';
	import { goto } from '$app/navigation';
	import IconArrowLeft from '@lucide/svelte/icons/arrow-left';
	import IconAlert from '@lucide/svelte/icons/triangle-alert';

	let username = $state('');
	let password = $state('');
	let totpSecret = $state('');
	let registry = $state('https://registry.npmjs.org/');
	let manualToken = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let needsManual = $state(false);

	async function submit(): Promise<void> {
		busy = true;
		error = null;
		needsManual = false;
		try {
			const res = await fetch('/api/add-profile', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${readWebToken()}` },
				body: JSON.stringify({ username, password, totpSecret, registry, manualToken: manualToken || undefined }),
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
				error = json.error ?? 'Failed to add profile.';
			}
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
			// Best-effort: clear the password fields from the DOM (burn-after-read is
			// enforced server-side; here we just avoid lingering in the input).
			password = '';
		}
	}
</script>

<svelte:head><title>Add Profile · pnpm-pub</title></svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-5 p-6">
	<a href="/" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
		<IconArrowLeft class="h-3.5 w-3.5" /> Back to Events
	</a>

	<header>
		<h1 class="text-lg font-semibold tracking-tight">Add Profile</h1>
		<p class="text-xs text-muted-foreground">
			We exchange your password for a long-lived token and burn the password immediately (Chapter 8.1).
		</p>
	</header>

	<Card>
		<CardHeader>
			<CardTitle>NPM credentials</CardTitle>
			<CardDescription>The password never touches disk — only the resulting token is stored in your keychain.</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3">
			<div class="space-y-1.5">
				<Label for="u">Username</Label>
				<Input id="u" bind:value={username} placeholder="john_doe" autocomplete="username" />
			</div>
			<div class="space-y-1.5">
				<Label for="p">Password</Label>
				<Input id="p" type="password" bind:value={password} placeholder="••••••••" autocomplete="current-password" />
			</div>
			<div class="space-y-1.5">
				<Label for="t">TOTP secret (base32)</Label>
				<Input id="t" bind:value={totpSecret} placeholder="JBSWY3DPEHPK3PXP" />
			</div>
			<div class="space-y-1.5">
				<Label for="r">Registry</Label>
				<Input id="r" bind:value={registry} />
			</div>

			{#if needsManual}
				<div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
					<IconAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
					<div>
						NPM refused the silent token apply ({error}). Paste a token generated from
						<a class="underline" target="_blank" rel="noreferrer" href="https://www.npmjs.com/settings/~/tokens">npmjs.com</a>:
					</div>
				</div>
				<div class="space-y-1.5">
					<Label for="m">Manual token (fallback)</Label>
					<Input id="m" bind:value={manualToken} placeholder="npm_..." />
				</div>
			{/if}

			{#if error && !needsManual}
				<div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{error}
				</div>
			{/if}

			<Button variant="brand" class="w-full" disabled={busy || !username || (!password && !manualToken) || !totpSecret} onclick={submit}>
				{busy ? 'Applying…' : 'Apply & save'}
			</Button>
		</CardContent>
	</Card>
</div>
