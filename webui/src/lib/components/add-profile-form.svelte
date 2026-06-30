<script lang="ts">
	/**
	 * The Add Profile form — shared by the Dialog surface (used when at least one
	 * profile exists) and the standalone `/add-profile` route (first-profile
	 * onboarding). The shell supplies the chrome (dialog vs full-page); this
	 * component owns the entire form state machine and POSTs to the daemon.
	 *
	 * State machine (one `phase` value):
	 *   - `silent`  : password + TOTP exchange. The password is transient; the
	 *                 daemon persists the resulting token + TOTP secret in the
	 *                 OS keychain for later renewal.
	 *   - `manual`  : surfaced only after `needsManualToken`. NPM refused the
	 *                 silent apply, so the user pastes a publish token. NOTE:
	 *                 the daemon persists a token + TOTP *pair* even on the
	 *                 manual path (web-server.ts:405-417), so TOTP stays
	 *                 required — it is NOT cleared when switching to manual.
	 *   - `success` : brief confirmation, then onSuccess fires (shell closes /
	 *                 routes home).
	 *
	 * Props:
	 *   - `onSuccess`  : called once after a successful apply (new profile is
	 *                    pushed over the WS by the daemon).
	 *   - `showAvatar` : render the daemon-backed npm identity preview (on by default).
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { InputGroup, InputGroupAddon } from '$lib/components/ui/input-group/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { errorToMessage } from '$lib/error-projection.js';
	import { parseNpmProfileLookupResponse, parseTokenApplyResponse } from '$lib/rest-response.js';
	import { readWebToken } from '$lib/store.js';
	import { parseTotpSecret, totpSecretError } from '$lib/totp.js';
	import TotpScanner from '$lib/components/totp-scanner.svelte';
	import IconAlert from '@lucide/svelte/icons/triangle-alert';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconKey from '@lucide/svelte/icons/key-round';
	import IconShield from '@lucide/svelte/icons/shield-check';
	import IconExternal from '@lucide/svelte/icons/external-link';
	import IconEye from '@lucide/svelte/icons/eye';
	import IconEyeOff from '@lucide/svelte/icons/eye-off';
	import IconScan from '@lucide/svelte/icons/scan-line';
	import { _ } from 'svelte-i18n';

	type Phase = 'silent' | 'manual' | 'success';

	let {
		onSuccess = () => {},
		showAvatar = true,
	}: { onSuccess?: () => void; showAvatar?: boolean } = $props();

	// --- form fields ---
	let username = $state('');
	let password = $state('');
	let totpRaw = $state(''); // whatever the user pasted (URI / spaced / base32)
	let registry = $state('https://registry.npmjs.org/');
	let manualToken = $state('');

	// --- UI state ---
	let phase = $state<Phase>('silent');
	let showPassword = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let scannerOpen = $state(false);

	// --- npm identity preview (daemon-backed; initials remain UI-only fallback) ---
	let avatarUrl = $state<string | null>(null);
	let avatarLoading = $state(false);
	let avatarReqId = 0;

	const trimmedUsername = $derived(username.trim());
	// Full parser (handles base32, otpauth://, otpauth-migration://, label|secret).
	const parsedTotp = $derived(parseTotpSecret(totpRaw));
	const totpSecret = $derived(parsedTotp?.secret ?? null); // normalized base32 or null
	// Best-effort: when a migration/otpauth paste carries an account name and the
	// user hasn't typed a username yet, auto-fill it (npm usernames usually match).
	$effect(() => {
		const account = parsedTotp?.account;
		if (account && username.trim() === '') username = account;
	});
	// Hint text: a multi-secret bundle is informational, not a hard block.
	const totpHint = $derived(totpSecretError(totpRaw));
	// Hard blocker: only when there's typed input but nothing parseable.
	const totpBlocker = $derived(totpRaw.trim().length > 0 && totpSecret === null);

	/**
	 * Submit gate. The daemon persists a `token + totpSecret` pair on BOTH paths
	 * (web-server.ts:405-417), so TOTP is mandatory in manual mode too. Silent
	 * additionally needs the password; manual needs the paste token instead.
	 */
	const canSubmit = $derived(
		!busy &&
			trimmedUsername.length > 0 &&
			totpSecret !== null &&
			(phase === 'manual' ? manualToken.trim().length > 0 : password.length > 0),
	);

	// Live identity lookup keyed on the debounced username. The daemon owns the
	// npm resolver so the UI never pretends initials are a fetched npm avatar.
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const name = trimmedUsername;
		const registryValue = registry.trim();
		if (debounceTimer) clearTimeout(debounceTimer);
		avatarLoading = name.length > 0;
		if (name.length === 0) {
			avatarUrl = null;
			avatarLoading = false;
			return;
		}
		debounceTimer = setTimeout(async () => {
			const reqId = ++avatarReqId;
			try {
				const query = new URLSearchParams({
					username: name,
					registry: registryValue || 'https://registry.npmjs.org/',
				});
				const res = await fetch(`/api/npm-profile?${query.toString()}`, {
					headers: { accept: 'application/json', authorization: `Bearer ${readWebToken()}` },
				});
				if (reqId !== avatarReqId) return; // superseded by a newer keystroke
				if (!res.ok) {
					avatarUrl = null;
					return;
				}
				const json = parseNpmProfileLookupResponse(await res.json());
				avatarUrl = json?.ok ? (json.profile?.avatarUrl ?? null) : null;
			} catch {
				if (reqId === avatarReqId) avatarUrl = null;
			} finally {
				if (reqId === avatarReqId) avatarLoading = false;
			}
		}, 280);
	});

	/** Clear the transient inputs the daemon does NOT persist. */
	function wipeSecrets(): void {
		password = '';
		manualToken = '';
	}

	async function submit(): Promise<void> {
		if (busy || !canSubmit) return;
		busy = true;
		error = null;
		const secret = totpSecret; // capture pre-send
		try {
			const res = await fetch('/api/add-profile', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${readWebToken()}` },
				body: JSON.stringify({
					username: trimmedUsername,
					// Silent needs the password for the NPM exchange; manual skips it.
					password: phase === 'silent' ? password : undefined,
					// ALWAYS sent: the daemon persists token + TOTP as a pair on both paths.
					totpSecret: secret,
					registry: registry.trim() || undefined,
					manualToken: phase === 'manual' ? manualToken.trim() || undefined : undefined,
				}),
			});
			const json = parseTokenApplyResponse(await res.json());
			if (!json) {
				error = $_('addProfile.invalidDaemon');
				return;
			}
			if (json.ok) {
				phase = 'success';
				wipeSecrets();
				setTimeout(onSuccess, 900);
				return;
			}
			if (json.needsManualToken) {
				// Switch to manual but KEEP the TOTP secret (daemon still needs it).
				phase = 'manual';
				wipeSecrets();
				error = json.error ?? null;
			} else {
				error = json.error ?? $_('addProfile.failed');
			}
		} catch (err) {
			error = errorToMessage(err);
		} finally {
			busy = false;
			// Clear the password after every silent attempt; it is never persisted.
			if (phase === 'silent') password = '';
		}
	}

	const initials = (name: string): string =>
		name.split(/[\s_-]+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '??';
</script>

{#if phase === 'success'}
	<div class="flex flex-col items-center gap-3 py-8 text-center">
		<div class="flex h-11 w-11 items-center justify-center rounded-full bg-success/15">
			<IconShield class="h-5 w-5 text-success" />
		</div>
		<div>
			<p class="text-sm font-medium">{$_('addProfile.profileAdded')}</p>
			<p class="mt-0.5 text-xs text-muted-foreground">{$_('common.done')}</p>
		</div>
	</div>
{:else}
	<div class="flex items-center gap-3">
		{#if showAvatar}
			<!-- NPM identity preview. Fallback initials are local UI only. -->
			<Avatar class="h-10 w-10 shrink-0 border border-border">
				{#if avatarUrl}
					<AvatarImage src={avatarUrl} alt={trimmedUsername} />
				{:else}
					<AvatarFallback>
						{#if avatarLoading}
							<IconLoader class="h-4 w-4 animate-spin text-muted-foreground" />
						{:else}
							{trimmedUsername ? initials(trimmedUsername) : '??'}
						{/if}
					</AvatarFallback>
				{/if}
			</Avatar>
		{/if}
		<div class="min-w-0 flex-1">
			<p class="flex items-center gap-1.5 text-sm font-medium leading-none">
				{#if phase === 'manual'}
					<IconKey class="h-3.5 w-3.5 text-warning" /> {$_('addProfile.manualHeading')}
				{:else}
					<IconShield class="h-3.5 w-3.5" /> {$_('addProfile.heading')}
				{/if}
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				{#if phase === 'manual'}
					{$_('addProfile.manualIntro')}
				{:else}
					{$_('addProfile.intro')}
				{/if}
			</p>
		</div>
	</div>

	<form class="space-y-3" onsubmit={(e) => { e.preventDefault(); submit(); }}>
		<!--
			TOTP secret comes FIRST: a migration link (otpauth-migration://) often
			embeds the account name, which we use to auto-fill the username below.
			It is ALWAYS collected (daemon persists token + TOTP as a pair); in
			manual mode it is carried over from the silent attempt.
		-->
		<div class="space-y-1.5">
			<Label for="ap-t">
				{$_('addProfile.totpSecret')}
			</Label>
			<InputGroup>
				<Input
					id="ap-t"
					bind:value={totpRaw}
					placeholder={$_('addProfile.totpFormats')}
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					disabled={busy}
				/>
				<InputGroupAddon>
					<button
						type="button"
						title="扫描二维码"
						class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
						onclick={() => (scannerOpen = true)}
						disabled={busy}
						aria-label="扫描二维码"
					>
						<IconScan class="h-4 w-4" />
					</button>
				</InputGroupAddon>
			</InputGroup>
			{#if totpBlocker}
				<p class="text-[11px] text-destructive">{totpHint}</p>
			{:else if totpSecret}
				<p class="text-[11px] {totpHint ? 'text-warning' : 'text-muted-foreground'}">
					{$_('addProfile.recognizedAs', { values: { secret: totpSecret } })}{#if parsedTotp?.label} ({parsedTotp.label}){/if}
				</p>
				{#if totpHint}
					<p class="text-[11px] text-warning">{totpHint}</p>
				{/if}
			{/if}
		</div>

		<!-- Username (auto-filled from a migration link's account when empty) -->
		<div class="space-y-1.5">
			<Label for="ap-u">{$_('addProfile.username')}</Label>
			<Input
				id="ap-u"
				bind:value={username}
				placeholder={$_('addProfile.usernamePlaceholder')}
				autocomplete="username"
				autocapitalize="none"
				spellcheck="false"
				disabled={busy}
			/>
		</div>

		{#if phase === 'silent'}
			<div class="space-y-1.5">
				<Label for="ap-p">{$_('addProfile.password')}</Label>
					<div class="relative">
						<Input
							id="ap-p"
							class="pr-9"
							type={showPassword ? 'text' : 'password'}
							bind:value={password}
							placeholder={$_('addProfile.passwordPlaceholder')}
							autocomplete="current-password"
							disabled={busy}
						/>
					<button
						type="button"
						tabindex="-1"
						class="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
						onclick={() => (showPassword = !showPassword)}
						aria-label={showPassword ? $_('addProfile.hidePassword') : $_('addProfile.showPassword')}
					>
						{#if showPassword}<IconEyeOff class="h-3.5 w-3.5" />{:else}<IconEye class="h-3.5 w-3.5" />{/if}
					</button>
				</div>
			</div>
		{/if}

		{#if phase === 'manual'}
			<div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
				<IconAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
				<div class="space-y-1">
					<p>{$_('addProfile.manualFailure', { values: { error: error ? `: ${error}` : '' } })}</p>
					<a
						class="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
						target="_blank"
						rel="noreferrer"
						href="https://www.npmjs.com/settings/~/tokens"
					>
						{$_('addProfile.createToken')} <IconExternal class="h-3 w-3" />
					</a>
				</div>
			</div>
			<div class="space-y-1.5">
				<Label for="ap-m">{$_('addProfile.manualToken')}</Label>
				<Input
					id="ap-m"
					bind:value={manualToken}
					placeholder={$_('addProfile.manualTokenPlaceholder')}
					autocomplete="off"
					autocapitalize="none"
					spellcheck="false"
					disabled={busy}
				/>
			</div>
		{/if}

		<!-- Registry (collapsed-detail; default works for almost everyone) -->
		<div class="space-y-1.5">
			<Label for="ap-r">{$_('addProfile.registry')}</Label>
			<Input id="ap-r" bind:value={registry} autocomplete="off" spellcheck="false" disabled={busy} />
		</div>

		{#if error && phase !== 'manual'}
			<div
				class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
				role="alert"
			>
				<IconAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<div class="break-words">{error}</div>
			</div>
		{/if}

		<div class="flex flex-col gap-2 pt-1">
			<Button type="submit" variant="brand" class="w-full" disabled={!canSubmit}>
				{#if busy}<IconLoader class="h-4 w-4 animate-spin" />{/if}
				{#if busy}
					{phase === 'manual' ? $_('addProfile.saving') : $_('addProfile.applying')}
				{:else}
					{phase === 'manual' ? $_('addProfile.saveToken') : $_('addProfile.applySave')}
				{/if}
			</Button>
			{#if phase === 'manual'}
				<button
					type="button"
					class="w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
					onclick={() => { phase = 'silent'; error = null; wipeSecrets(); }}
					disabled={busy}
				>
					{$_('addProfile.trySilent')}
				</button>
			{/if}
			</div>
		</form>
{/if}

<!-- TOTP 扫码弹层（全局单实例，scannerOpen 控制）。扫到合法 secret 自动回填 totpRaw。 -->
<TotpScanner bind:open={scannerOpen} onResult={(s) => (totpRaw = s)} />
