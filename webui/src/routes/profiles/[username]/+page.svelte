<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { actions, daemon, closeAddProfile } from '$lib/store.js';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
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
	import IconRegistry from '@lucide/svelte/icons/server';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconKey from '@lucide/svelte/icons/key-round';
	import IconEye from '@lucide/svelte/icons/eye';
	import IconEyeOff from '@lucide/svelte/icons/eye-off';
	import IconCopy from '@lucide/svelte/icons/copy';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconMail from '@lucide/svelte/icons/mail';
	import IconShieldCheck from '@lucide/svelte/icons/shield-check';
	import IconShieldOff from '@lucide/svelte/icons/shield-x';
	import IconGithub from '@lucide/svelte/icons/code';
	import IconTwitter from '@lucide/svelte/icons/at-sign';
	import IconLink from '@lucide/svelte/icons/globe';
	import IconCalendar from '@lucide/svelte/icons/calendar';
	import { apiFetch } from '$lib/api-fetch.js';
	import { parseProfileTokenResponse, parseProfileDetailResponse } from '$lib/rest-response.js';
	import type { ProfileDetail } from '$lib/types.js';
	import { _ } from 'svelte-i18n';

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

	// Reset token state when navigating between profiles.
	$effect(() => {
		void username;
		token = null;
		tokenError = null;
		tokenLoading = false;
		showToken = false;
		copied = false;
	});

	// ----- profile detail (email / social / 2FA / created) -----
	// Fetched live from the registry via the active profile's token; never
	// persisted. Only meaningful for the active profile, so we gate on that.
	let detail = $state<ProfileDetail | null>(null);
	let detailLoading = $state(false);
	let detailError = $state<string | null>(null);

	const isActive = $derived(profile?.username === $daemon.defaultProfile);

	$effect(() => {
		const u = username;
		const active = isActive;
		detail = null;
		detailError = null;
		if (!active) return;
		// Fetch on mount / when the active profile matches this route.
		void u;
		loadDetail();
	});

	async function loadDetail(): Promise<void> {
		if (detailLoading || detail) return;
		detailLoading = true;
		detailError = null;
		try {
			const res = await apiFetch('/api/profile-detail');
			const json = parseProfileDetailResponse(await res.json());
			if (json?.ok && json.detail) {
				detail = json.detail;
			} else {
				detailError = json?.error ?? $_('profile.detailLoadError');
			}
		} catch {
			detailError = $_('profile.detailLoadError');
		} finally {
			detailLoading = false;
		}
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
		} catch {
			return iso.slice(0, 10);
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
						<span class="truncate">{profile.username}</span>
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
					<p class="truncate text-xs text-muted-foreground">{profile.registry ?? 'https://registry.npmjs.org/'}</p>
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

		<section class="grid gap-3 sm:grid-cols-2">
				<div class="rounded-lg border border-border bg-card p-4">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
							<IconUser /> {$_('profile.identity')}
						</div>
						{#if detailLoading}
							<IconLoader class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						{/if}
					</div>
					<p class="mt-2 truncate text-sm font-medium">{profile.username}</p>
					{#if !isActive}
						<p class="mt-1 text-xs text-muted-foreground">{$_('profile.defaultNo')}</p>
					{:else if detailError}
						<p class="mt-1 text-xs text-destructive">{detailError}</p>
					{:else if detail}
						<dl class="mt-2 space-y-1.5">
							{#if detail.email}
								<div class="flex items-center gap-2 text-xs">
									<IconMail class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<a href={`mailto:${detail.email}`} class="truncate text-foreground transition-colors hover:text-brand hover:underline">{detail.email}</a>
									{#if detail.emailVerified === false}
										<span class="shrink-0 text-[10px] text-warning">({$_('profile.emailUnverified')})</span>
									{/if}
								</div>
							{/if}
							{#if detail.tfaEnabled !== null}
								<div class="flex items-center gap-2 text-xs">
									{#if detail.tfaEnabled}
										<IconShieldCheck class="h-3.5 w-3.5 shrink-0 text-success" />
									{:else}
										<IconShieldOff class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									{/if}
									<span class="text-muted-foreground">{$_('profile.twoFactor')}</span>
									<span class={detail.tfaEnabled ? 'text-success' : 'text-muted-foreground'}>
										{detail.tfaEnabled ? $_('profile.twoFactorOn') : $_('profile.twoFactorOff')}
									</span>
								</div>
							{/if}
							{#if detail.github}
								<div class="flex items-center gap-2 text-xs">
									<IconGithub class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<a href={`https://github.com/${detail.github}`} target="_blank" rel="noreferrer" class="truncate text-foreground transition-colors hover:text-brand hover:underline">{detail.github}</a>
								</div>
							{/if}
							{#if detail.twitter}
								<div class="flex items-center gap-2 text-xs">
									<IconTwitter class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<a href={`https://twitter.com/${detail.twitter}`} target="_blank" rel="noreferrer" class="truncate text-foreground transition-colors hover:text-brand hover:underline">@{detail.twitter}</a>
								</div>
							{/if}
							{#if detail.homepage}
								<div class="flex items-center gap-2 text-xs">
									<IconLink class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<a href={detail.homepage} target="_blank" rel="noreferrer" class="truncate text-foreground transition-colors hover:text-brand hover:underline">{detail.homepage}</a>
								</div>
							{/if}
							{#if detail.createdAt}
								<div class="flex items-center gap-2 text-xs">
									<IconCalendar class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<span class="text-muted-foreground">{$_('profile.memberSince')}</span>
									<span>{formatDate(detail.createdAt)}</span>
								</div>
							{/if}
						</dl>
					{:else if detailLoading}
						<p class="mt-1 text-xs text-muted-foreground">{$_('common.loading')}</p>
					{/if}
				</div>
			<div class="rounded-lg border border-border bg-card p-4">
				<div class="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
					<IconRegistry /> {$_('profile.registry')}
				</div>
				<p class="mt-2 truncate font-mono text-xs">{profile.registry ?? 'https://registry.npmjs.org/'}</p>
				<p class="mt-1 text-xs text-muted-foreground">{$_('profile.secretsStored')}</p>
			</div>
		</section>

		<!-- npm_token export -->
		<section class="rounded-lg border border-border bg-card p-4">
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
					<IconKey /> {$_('profile.npmToken')}
				</div>
				<div class="flex shrink-0 items-center gap-1.5">
					{#if token}
						<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => (showToken = !showToken)} aria-label={showToken ? $_('addProfile.hidePassword') : $_('addProfile.showPassword')} title={showToken ? $_('addProfile.hidePassword') : $_('addProfile.showPassword')}>
							{#if showToken}<IconEyeOff class="h-3.5 w-3.5" />{:else}<IconEye class="h-3.5 w-3.5" />{/if}
						</Button>
						<Button variant="ghost" size="icon" class="h-7 w-7" onclick={copyToken} aria-label={$_('profile.copyToken')} title={$_('profile.copyToken')}>
							{#if copied}<IconCheck class="h-3.5 w-3.5 text-success" />{:else}<IconCopy class="h-3.5 w-3.5" />{/if}
						</Button>
					{:else if tokenLoading}
						<IconLoader class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
					{:else}
						<Button variant="outline" size="sm" onclick={loadToken}>
							<IconEye class="h-3.5 w-3.5" /> {$_('profile.revealToken')}
						</Button>
					{/if}
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
		</section>
	</div>
{:else}
	<div class="mx-auto flex max-w-3xl flex-col gap-5 p-6">
		<div class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
			{$_('profile.noProfileRoute')}
		</div>
	</div>
{/if}
