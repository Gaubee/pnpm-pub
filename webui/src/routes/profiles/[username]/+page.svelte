<script lang="ts">
	import { goto, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { actions, daemon, closeAddProfile } from '$lib/store.js';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle,
	} from '$lib/components/ui/alert-dialog/index.js';
	import {
		Tooltip,
		TooltipContent,
		TooltipTrigger,
	} from '$lib/components/ui/tooltip/index.js';
	import IconTrash from '@lucide/svelte/icons/trash-2';
	import IconUser from '@lucide/svelte/icons/user-round';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconKey from '@lucide/svelte/icons/key-round';
	import IconEye from '@lucide/svelte/icons/eye';
	import IconEyeOff from '@lucide/svelte/icons/eye-off';
	import IconCopy from '@lucide/svelte/icons/copy';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconMail from '@lucide/svelte/icons/mail';
	import IconLink from '@lucide/svelte/icons/globe';
	import { apiFetch } from '$lib/api-fetch.js';
	import {
		parseProfileTokenResponse,
		parseProfilePasswordResponse,
		parseProfileDetailResponse,
		parseTokenApplyResponse,
	} from '$lib/rest-response.js';
	import type { ProfileDetail } from '$lib/types.js';
	import { _ } from 'svelte-i18n';
	import { untrack } from 'svelte';
	import IconAlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import IconRefresh from '@lucide/svelte/icons/refresh-cw';
	import IconTimer from '@lucide/svelte/icons/timer';
	import IconX from '@lucide/svelte/icons/x';

	let deleteOpen = $state(false);
	let deleting = $state(false);
	let error = $state<string | null>(null);
	// Type-to-confirm: must match the profile username exactly.
	let confirmName = $state('');

	const username = $derived(decodeURIComponent(page.params.username ?? ''));
	const profile = $derived($daemon.profiles.find((item) => item.username === username) ?? null);
	const canDelete = $derived(confirmName.trim() === username);

	$effect(() => {
		if (!$daemon.profilesLoaded || profile) return;
		goto(`/${window.location.hash}`, { replaceState: true });
	});

	$effect(() => {
		void username;
		confirmName = '';
		error = null;
		deleteOpen = false;
	});

	function initials(name: string): string {
		return name
			.split(/[\s_-]+/)
			.map((part) => part[0])
			.join('')
			.slice(0, 2)
			.toUpperCase() || '??';
	}

	async function deleteProfile(): Promise<void> {
		if (!profile || deleting || !canDelete) return;
		deleting = true;
		error = null;
		try {
			const ok = await actions.deleteProfile(profile.username);
			if (!ok) {
				error = $_('profile.deleteFailed', { values: { username: profile.username } });
				return;
			}
			deleteOpen = false;
			closeAddProfile(true);
			goto(`/${window.location.hash}`, { replaceState: true });
		} catch {
			error = $_('profile.deleteError');
		} finally {
			deleting = false;
		}
	}

	// ----- npm_token export (show / copy) -----
	let tokenLoading = $state(false);
	let token = $state<string | null>(null);
	let tokenError = $state<string | null>(null);
	let showToken = $state(false);
	let copied = $state(false);

	async function loadToken(): Promise<void> {
		if (tokenLoading || token) return;
		tokenLoading = true;
		tokenError = null;
		try {
			const res = await apiFetch(`/api/profile-token?username=${encodeURIComponent(username)}`);
			const json = parseProfileTokenResponse(await res.json());
			if (json?.ok && json.token) {
				token = json.token;
				showToken = true;
			} else {
				tokenError = json?.error ?? $_('profile.tokenError');
			}
		} catch {
			tokenError = $_('profile.tokenError');
		} finally {
			tokenLoading = false;
		}
	}

	async function copyToken(): Promise<void> {
		if (!token) return;
		try {
			await navigator.clipboard.writeText(token);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard unavailable */
		}
	}

	// Reset token + detail state when navigating between profiles.
	$effect(() => {
		void username;
		token = null;
		tokenError = null;
		tokenLoading = false;
		showToken = false;
		copied = false;
		// Restore cached detail instantly (stale-while-revalidate); the fetch
		// effect will refresh it in the background.
		detail = detailCache.get(username) ?? null;
		detailError = null;
		activeDetailReq++;
	});

	// ----- profile detail (email / social / 2FA / created) -----
	// Fetched live from the registry via the active profile's token; never
	// persisted. Only meaningful for the active profile, so we gate on that.
	// Stale-while-revalidate: a module-level cache keyed by username lets us show
	// the previous detail instantly when revisiting a profile, while a fresh
	// fetch updates it in the background. The cache survives route changes but
	// is cleared on renew (the identity may change with a new token).
	const detailCache = new Map<string, ProfileDetail>();
	let detail = $state<ProfileDetail | null>(null);
	let detailLoading = $state(false);
	let detailError = $state<string | null>(null);
	// Guards against duplicate / racing fetches when the effect re-runs.
	let activeDetailReq = 0;

	const isActive = $derived(profile?.username === $daemon.defaultProfile);

	$effect(() => {
		// Track only the inputs that should (re)trigger a fetch.
		const u = username;
		const active = isActive;
		const token = $daemon.defaultProfile;
		void token;
		if (!active || !u) return;
		// Perform the fetch + state writes outside the effect's reactive
		// tracking so writing detail/detailLoading doesn't re-trigger us.
		void untrack(() => loadDetail());
	});

	async function loadDetail(): Promise<void> {
		const reqId = ++activeDetailReq;
		// Only show the loading spinner when there's no cached data to display
		// yet. With a cache hit we keep the stale detail visible (no spinner)
		// and refresh silently in the background.
		const cached = detailCache.get(username);
		if (cached) {
			detail = cached;
			detailLoading = false;
		} else {
			detail = null;
			detailLoading = true;
		}
		detailError = null;
		try {
			const res = await apiFetch('/api/profile-detail');
			// Stale response guard: a newer request superseded this one.
			if (reqId !== activeDetailReq) return;
			const json = parseProfileDetailResponse(await res.json());
			if (reqId !== activeDetailReq) return;
			if (json?.ok && json.detail) {
				detail = json.detail;
				detailCache.set(username, json.detail);
			} else if (json?.needsReauth) {
				// Daemon's liveness probe found the token invalid — the inline
				// re-auth card (driven by authStatus) takes over; no error toast.
				detail = null;
			} else {
				detailError = json?.error ?? $_('profile.detailLoadError');
			}
		} catch {
			if (reqId !== activeDetailReq) return;
			detailError = $_('profile.detailLoadError');
		} finally {
			if (reqId === activeDetailReq) detailLoading = false;
		}
	}

	// ----- inline re-auth (token expired / invalid) -----
	// Shows an inline card (non-blocking). Two open modes share ONE form:
	//   - forced  (token expired, authStatus !== 'authenticated'): the card is
	//     always open and cannot be dismissed — the user MUST renew.
	//   - voluntary (token still valid): opened by the "Renew token" button in
	//     the header, dismissible via Cancel.
	type ReauthPhase = 'idle' | 'submitting' | 'manual';
	const needsReauth = $derived(
		isActive && (profile?.authStatus ?? 'unauthenticated') !== 'authenticated',
	);
	// `renewForced` drives dismissability. It's a snapshot of needsReauth at the
	// point the card is open so the Cancel button logic is stable.
	let renewOpen = $state(false);
	let renewForced = $state(false);
	// A forced card stays open as long as the token is invalid; a voluntary one
	// is closed when the user dismisses it or a renew succeeds.
	$effect(() => {
		if (needsReauth) {
			renewForced = true;
			renewOpen = true;
		} else {
			renewForced = false;
		}
	});
	let reauthPhase = $state<ReauthPhase>('idle');
	let reauthPassword = $state('');
	let reauthPasswordLoaded = $state(false);
	let reauthShowPassword = $state(false);
	let reauthBusy = $state(false);
	let reauthError = $state<string | null>(null);
	let manualToken = $state('');

	// When the re-auth card opens, lazily pre-fill the stored password so the
	// user can renew in one click (but can still edit it).
	$effect(() => {
		const open = renewOpen;
		if (!open || reauthPasswordLoaded) return;
		void untrack(() => loadStoredPassword());
	});

	async function loadStoredPassword(): Promise<void> {
		try {
			const res = await apiFetch(`/api/profile-password?username=${encodeURIComponent(username)}`);
			const json = parseProfilePasswordResponse(await res.json());
			if (json?.ok && json.password) reauthPassword = json.password;
		} catch {
			/* leave empty — user types it */
		} finally {
			reauthPasswordLoaded = true;
		}
	}

	const canReauth = $derived(
		!reauthBusy &&
			username.length > 0 &&
			(reauthPhase === 'manual' ? manualToken.trim().length > 0 : reauthPassword.length > 0),
	);

	// Block navigation while a renewal is in flight so the token isn't left
	// half-minted. The card itself stays non-blocking otherwise (the user can
	// still see the avatar / delete the profile while composing the renewal).
	beforeNavigate(({ to, cancel }) => {
		if (!reauthBusy) return;
		// Allow the delete-success redirect (profile gone) but block everything else.
		if (to?.url.pathname === `/profiles/${encodeURIComponent(username)}`) return;
		cancel();
	});

	async function submitReauth(): Promise<void> {
		if (!canReauth) return;
		reauthBusy = true;
		reauthError = null;
		try {
			const res = await apiFetch('/api/renew', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					username,
					password: reauthPhase === 'manual' ? undefined : reauthPassword,
					manualToken: reauthPhase === 'manual' ? manualToken.trim() || undefined : undefined,
				}),
			});
			const json = parseTokenApplyResponse(await res.json());
			if (json?.ok) {
				// Success: daemon flipped authStatus → 'authenticated' and broadcast a
				// fresh profiles frame (new token persisted). The cached npm_token +
				// profile detail are now stale, so clear them and reload. For a forced
				// (expired) card needsReauth becomes false and closes the card; for a
				// voluntary card the token was already valid, so close it explicitly.
				reauthPhase = 'idle';
				if (!renewForced) renewOpen = false;
				// Drop the old token so the next Reveal re-fetches the new one.
				token = null;
				tokenError = null;
				showToken = false;
				// Invalidate the detail cache (the new token may resolve to a
				// different identity) and force a fresh reload.
				detailCache.delete(username);
				void untrack(() => loadDetail());
			} else if (json?.needsManualToken) {
				// NPM refused the password-based apply (OTP mismatch / IP block /
				// rate-limit). Switch to the manual-token paste path, but ALSO
				// surface the registry's error so the user sees WHY (e.g. a wrong
				// OTP or password) instead of a silent jump to manual mode.
				reauthPhase = 'manual';
				reauthError = json?.error ?? null;
			} else {
				reauthError = json?.error ?? $_('profile.reauthError');
			}
		} catch {
			reauthError = $_('profile.reauthError');
		} finally {
			reauthBusy = false;
		}
	}

	// ----- auto-renew toggle -----
	const autoRenewOn = $derived(profile?.autoRenew ?? false);
	let autoRenewBusy = $state(false);
	async function toggleAutoRenew(next: boolean): Promise<void> {
		if (autoRenewBusy || !profile) return;
		autoRenewBusy = true;
		try {
			const res = await apiFetch('/api/profile/auto-renew', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username, autoRenew: next }),
			});
			const json = await res.json();
			if (!json?.ok) throw new Error('toggle failed');
			// The daemon broadcasts a fresh profiles frame; the derived `profile`
			// reflows and the switch reflects the persisted state.
		} catch {
			/* leave as-is; the switch reverts via the derived */
		} finally {
			autoRenewBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{profile ? $_('profile.title', { values: { username: profile.username } }) : $_('profile.noProfile')}</title>
</svelte:head>

{#if profile}
	<div class="mx-auto flex max-w-3xl flex-col gap-5 p-6">
		<header class="flex items-start justify-between gap-4">
			<div class="flex min-w-0 items-center gap-3">
				<Avatar class="size-12 border border-border">
					{#if profile.avatarUrl}
						<AvatarImage src={profile.avatarUrl} alt={profile.username} />
					{:else}
						<AvatarFallback>{initials(profile.username)}</AvatarFallback>
					{/if}
				</Avatar>
				<div class="min-w-0">
					<h1 class="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
						<span class="truncate">
							{#if detail?.fullname}
								{detail.fullname}
							{:else if isActive && detailLoading}
								{profile.username}
							{:else}
								{profile.username}
							{/if}
						</span>
						{#if profile.username === $daemon.defaultProfile}
							<Tooltip>
								<TooltipTrigger>
									{#snippet child({ props })}
										<Badge variant="brand" {...props}>{$_('profile.defaultLabel')}</Badge>
									{/snippet}
								</TooltipTrigger>
								<TooltipContent>{$_('profile.defaultHint')}</TooltipContent>
							</Tooltip>
						{/if}
					</h1>
					<p class="truncate text-xs text-muted-foreground">
						{#if isActive && detailLoading && !detail}
							{$_('common.loading')}
						{:else}
							{profile.registry ?? 'https://registry.npmjs.org/'}
						{/if}
					</p>
				</div>
			</div>
			<AlertDialog bind:open={deleteOpen}>
				<Button variant="destructive" size="sm" onclick={() => (deleteOpen = true)}>
					<IconTrash /> {$_('profile.delete')}
				</Button>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{$_('profile.deleteTitle', { values: { username: profile.username } })}</AlertDialogTitle>
						<AlertDialogDescription>{$_('profile.deleteDescription')}</AlertDialogDescription>
					</AlertDialogHeader>
					<div class="space-y-2">
						<p class="text-sm text-muted-foreground">
							{$_('profile.deleteConfirmLabel', { values: { username: profile.username } })}
						</p>
						<Input
							bind:value={confirmName}
							placeholder={profile.username}
							autocomplete="off"
							spellcheck={false}
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>{$_('common.cancel')}</AlertDialogCancel>
						<AlertDialogAction variant="destructive" disabled={deleting || !canDelete} onclick={deleteProfile}>
							{#if deleting}<IconLoader class="animate-spin" />{/if}
							{$_('profile.deleteProfile')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</header>

		{#if error}
			<div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
				{error}
			</div>
		{/if}

		<!-- npm_token export (+ inline renew form, merged into one card) -->
		<section class="rounded-lg border border-border bg-card p-4">
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
					<IconKey /> {$_('profile.npmToken')}
					{#if autoRenewOn}
						<Tooltip>
							<TooltipTrigger>
								{#snippet child({ props })}
									<Badge {...props} variant="brand" class="gap-1 normal-case">
										<IconTimer class="h-3 w-3" /> {$_('profile.autoRenew')}
									</Badge>
								{/snippet}
							</TooltipTrigger>
							<TooltipContent class="max-w-xs text-[11px]">
								{$_('profile.autoRenewHint')}
							</TooltipContent>
						</Tooltip>
					{/if}
				</div>
				<!-- Header actions as a single ButtonGroup. The Renew toggle and the
					 Reveal/Copy buttons are independent — toggling renew never hides the
					 token actions, so the group stays stable. -->
				<div class="flex shrink-0 items-center">
					<ButtonGroup.Root>
						{#if isActive && !needsReauth}
							<Toggle size="sm" variant="outline" bind:pressed={renewOpen}>
								<IconRefresh /> {$_('profile.renewToken')}
							</Toggle>
						{/if}
						{#if token}
							<Button variant="outline" size="icon-sm" onclick={() => (showToken = !showToken)} aria-label={showToken ? $_('addProfile.hidePassword') : $_('addProfile.showPassword')} title={showToken ? $_('addProfile.hidePassword') : $_('addProfile.showPassword')}>
								{#if showToken}<IconEyeOff class="h-3.5 w-3.5" />{:else}<IconEye class="h-3.5 w-3.5" />{/if}
							</Button>
							<Button variant="outline" size="icon-sm" onclick={copyToken} aria-label={$_('profile.copyToken')} title={$_('profile.copyToken')}>
								{#if copied}<IconCheck class="h-3.5 w-3.5 text-success" />{:else}<IconCopy class="h-3.5 w-3.5" />{/if}
							</Button>
						{:else if tokenLoading}
							<Button variant="outline" size="icon-sm" disabled aria-label={$_('common.loading')}>
								<IconLoader class="h-3.5 w-3.5 animate-spin" />
							</Button>
						{:else}
							<Button variant="outline" size="icon-sm" onclick={loadToken} aria-label={$_('profile.revealToken')} title={$_('profile.revealToken')}>
								<IconEye class="h-3.5 w-3.5" />
							</Button>
						{/if}
					</ButtonGroup.Root>
				</div>
			</div>
			<div class="mt-2">
				{#if tokenError}
					<p class="text-xs text-destructive">{tokenError}</p>
				{:else if token}
					<p class="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[11px]">
						{showToken ? token : '•'.repeat(Math.min(token.length, 40))}
					</p>
				{:else}
					<p class="text-xs text-muted-foreground">{$_('profile.tokenHidden')}</p>
				{/if}
			</div>

			{#if renewOpen}
				<!-- Inline renew form, separated from the token block by a divider
					 (no nested card). Forced (token expired) cannot be dismissed;
					 voluntary (Renew toggle) is closable via the X button. -->
				<Separator class="my-4" />
				<div class="flex items-start gap-2">
					{#if renewForced}
						<IconAlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
					{:else}
						<IconRefresh class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
					{/if}
					<div class="min-w-0 flex-1 space-y-3">
						<div class="flex items-start justify-between gap-2">
							<div>
								<h3 class="text-sm font-semibold text-foreground">
									{renewForced ? $_('profile.reauthTitle') : $_('profile.renewTitle')}
								</h3>
								<p class="mt-0.5 text-xs text-muted-foreground">
									{renewForced ? $_('profile.reauthIntro') : $_('profile.renewIntro')}
								</p>
							</div>
							{#if !renewForced}
								<Button variant="ghost" size="icon" class="-mr-1.5 -mt-1 h-6 w-6 shrink-0" onclick={() => (renewOpen = false)} disabled={reauthBusy} aria-label={$_('profile.reauthCancel')}>
									<IconX class="h-3.5 w-3.5" />
								</Button>
							{/if}
						</div>

							{#if reauthPhase !== 'manual'}
								<div class="space-y-1.5">
									<label class="text-xs font-medium text-muted-foreground" for="reauth-password">
										{$_('profile.reauthPassword')}
									</label>
									<div class="relative">
										<Input
											id="reauth-password"
											type={reauthShowPassword ? 'text' : 'password'}
											bind:value={reauthPassword}
											placeholder={$_('profile.reauthPassword')}
											autocomplete="current-password"
											disabled={reauthBusy}
											class="pr-9"
										/>
										<Button variant="ghost" size="icon-sm" class="absolute right-0.5 top-0.5 h-6 w-6 text-muted-foreground" onclick={() => (reauthShowPassword = !reauthShowPassword)} disabled={reauthBusy} aria-label={reauthShowPassword ? $_('addProfile.hidePassword') : $_('addProfile.showPassword')} title={reauthShowPassword ? $_('addProfile.hidePassword') : $_('addProfile.showPassword')} tabindex={-1}>
											{#if reauthShowPassword}<IconEyeOff class="h-3.5 w-3.5" />{:else}<IconEye class="h-3.5 w-3.5" />{/if}
										</Button>
									</div>
									<p class="text-[11px] text-muted-foreground">{$_('profile.reauthPasswordHint')}</p>
								</div>
						{:else}
							<div class="space-y-1.5">
								<label class="text-xs font-medium text-muted-foreground" for="manual-token">
									{$_('profile.reauthManualToken')}
								</label>
								<Input
									id="manual-token"
									type="text"
									bind:value={manualToken}
									placeholder={$_('profile.reauthManualTokenPlaceholder')}
									autocomplete="off"
									disabled={reauthBusy}
								/>
								<p class="text-[11px] text-muted-foreground">{$_('profile.reauthManualTokenHint')}</p>
							</div>
						{/if}

						{#if reauthError}
							<p class="text-xs text-destructive">{reauthError}</p>
						{/if}

						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								<Button size="sm" onclick={submitReauth} disabled={!canReauth}>
									{#if reauthBusy}<IconLoader class="h-3.5 w-3.5 animate-spin" />{/if}
									{$_('profile.reauthSubmit')}
								</Button>
								{#if reauthPhase === 'manual'}
									<Button size="sm" variant="ghost" onclick={() => (reauthPhase = 'idle')} disabled={reauthBusy}>
										{$_('profile.reauthUsePassword')}
									</Button>
								{:else}
									<Button size="sm" variant="ghost" onclick={() => (reauthPhase = 'manual')} disabled={reauthBusy}>
										{$_('profile.reauthUseManualToken')}
									</Button>
								{/if}
							</div>
							<!-- AutoRenew (inline-end): re-mint the token with the stored
							     password before it expires. -->
							<Tooltip>
								<TooltipTrigger>
									{#snippet child({ props })}
										<div {...props} class="flex items-center gap-1.5">
											<IconTimer class="h-3.5 w-3.5 text-muted-foreground" />
											<span class="text-[11px] text-muted-foreground">{$_('profile.autoRenew')}</span>
											<Switch
												checked={autoRenewOn}
												disabled={autoRenewBusy}
												onCheckedChange={(v: boolean) => toggleAutoRenew(v)}
											/>
										</div>
									{/snippet}
								</TooltipTrigger>
								<TooltipContent class="max-w-xs text-[11px]">
									{$_('profile.autoRenewHint')}
								</TooltipContent>
							</Tooltip>
						</div>
					</div>
				</div>
			{/if}
		</section>

		<!-- Identity (registry detail: email / linked accounts / 2FA / created) -->
		<section>
				<div class="rounded-lg border border-border bg-card p-4">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
							<IconUser /> {$_('profile.identity')}
						</div>
						{#if isActive && detailLoading}
							<IconLoader class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						{/if}
					</div>
					<dl class="mt-2.5 space-y-2.5">
						<!-- id (always available) -->
						<div class="flex items-center gap-2 text-xs">
							<span class="w-20 shrink-0 text-muted-foreground">{$_('profile.idLabel')}</span>
							<span class="truncate font-mono text-foreground">{profile.username}</span>
						</div>
						{#if isActive}
							{#if detailError}
								<p class="text-xs text-destructive">{detailError}</p>
							{:else if detail}
								<!-- email -->
								{#if detail.email}
									<div class="flex items-center gap-2 text-xs">
										<span class="w-20 shrink-0 text-muted-foreground">{$_('profile.email')}</span>
										<a href={`mailto:${detail.email}`} class="truncate text-foreground transition-colors hover:text-brand hover:underline">{detail.email}</a>
										{#if detail.emailVerified === false}
											<span class="shrink-0 text-[10px] text-warning">({$_('profile.emailUnverified')})</span>
										{/if}
									</div>
								{/if}
								<!-- Linked Accounts -->
								{#if detail.github || detail.twitter || detail.homepage}
									<div class="space-y-1 pt-0.5 flex flex-col gap-2">
										<span class="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{$_('profile.linkedAccounts')}</span>
										{#if detail.github}
											<div class="flex items-center gap-2 text-xs">
												<svg class="block h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
												<a href={`https://github.com/${detail.github}`} target="_blank" rel="noreferrer" class="truncate text-foreground transition-colors hover:text-brand hover:underline">{detail.github}</a>
											</div>
										{/if}
										{#if detail.twitter}
											<div class="flex items-center gap-2 text-xs">
												<svg class="block h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
												<a href={`https://twitter.com/${detail.twitter}`} target="_blank" rel="noreferrer" class="truncate text-foreground transition-colors hover:text-brand hover:underline">@{detail.twitter}</a>
											</div>
										{/if}
										{#if detail.homepage}
											<div class="flex items-center gap-2 text-xs">
												<IconLink class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
												<a href={detail.homepage} target="_blank" rel="noreferrer" class="truncate text-foreground transition-colors hover:text-brand hover:underline">{detail.homepage}</a>
											</div>
										{/if}
									</div>
								{/if}
							{:else if detailLoading}
								<p class="text-xs text-muted-foreground">{$_('common.loading')}</p>
							{/if}
						{:else}
							<p class="text-xs text-muted-foreground">{$_('profile.inactiveDetailHint')}</p>
						{/if}
					</dl>
				</div>
		</section>
	</div>
{:else}
	<div class="mx-auto flex max-w-3xl flex-col gap-5 p-6">
		<div class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
			{$_('profile.noProfileRoute')}
		</div>
	</div>
{/if}
