<script lang="ts">
	/**
	 * Import / Export — password-protected cross-device migration (Chapter 8.2).
	 * Export builds an AES-256-GCM bundle (PBKDF2-derived key). Import shows the
	 * plaintext profile list first, then asks for the password + selection.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { parseBackupBundleJson } from '$lib/backup-bundle.js';
	import { errorToMessage } from '$lib/error-projection.js';
	import { getRpcClient } from '$lib/store.js';
	import IconDownload from '@lucide/svelte/icons/download';
	import IconUpload from '@lucide/svelte/icons/upload';
	import { _ } from 'svelte-i18n';

	type ImportPreview = { profiles: string[] } | null;

	let exportPassword = $state('');
	let exportResult = $state<string | null>(null);
	let exportError = $state<string | null>(null);

	let importBundle = $state('');
	let importPreview = $state<ImportPreview>(null);
	let importPassword = $state('');
	let importSelected = $state<Set<string>>(new Set());
	let importError = $state<string | null>(null);
	let importDone = $state<string[] | null>(null);

	async function doExport(): Promise<void> {
		exportError = null;
		exportResult = null;
		try {
			const json = await getRpcClient()?.backup.export({ password: exportPassword });
			exportPassword = '';
			if (!json) {
				exportError = $_('backup.invalidDaemon');
				return;
			}
			if (json.ok) {
				exportResult = JSON.stringify(json.bundle, null, 2);
			} else {
				exportError = json.error ?? $_('backup.exportFailed');
			}
		} catch (err) {
			exportError = errorToMessage(err);
		}
	}

	function previewImport(): void {
		importError = null;
		importDone = null;
		const parsed = parseBackupBundleJson(importBundle);
		if (!parsed.ok) {
			if (parsed.reason === 'invalid-json') {
				importError = $_('backup.invalidJson');
				return;
			}
			importError = $_('backup.invalidBackup');
			return;
		}
		importPreview = { profiles: parsed.bundle.profiles };
		importSelected = new Set(parsed.bundle.profiles);
	}

	async function doImport(): Promise<void> {
		importError = null;
		importDone = null;
		const parsed = parseBackupBundleJson(importBundle);
		if (!parsed.ok) {
			if (parsed.reason === 'invalid-json') {
				importError = $_('backup.invalidJson');
				return;
			}
			importError = $_('backup.invalidBackup');
			return;
		}
		try {
			const bundle = parsed.bundle;
			const json = await getRpcClient()?.backup.import({
				bundle,
				password: importPassword,
				usernames: [...importSelected],
			});
			importPassword = '';
			if (!json) {
				importError = $_('backup.invalidDaemon');
				return;
			}
			if (json.ok) {
				importDone = json.imported ?? [];
			} else {
				importError = json.error ?? $_('backup.importFailed');
			}
		} catch (err) {
			importError = errorToMessage(err);
		}
	}

	function toggle(name: string): void {
		const next = new Set(importSelected);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		importSelected = next;
	}

	function download(): void {
		if (!exportResult) return;
		const blob = new Blob([exportResult], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'pnpm-pub-backup.json';
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head><title>{$_('backup.title')}</title></svelte:head>

<div class="mx-auto grid max-w-3xl gap-5 p-6 md:grid-cols-2">
	<header class="md:col-span-2">
		<h1 class="text-lg font-semibold tracking-tight">{$_('backup.heading')}</h1>
		<p class="text-xs text-muted-foreground">{$_('backup.intro')}</p>
	</header>

	<!-- Export -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><IconDownload class="h-4 w-4" /> {$_('backup.export')}</CardTitle>
			<CardDescription>{$_('backup.exportIntro')}</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3">
			<div class="space-y-1.5">
				<Label for="ep">{$_('backup.protectionPassword')}</Label>
				<Input id="ep" type="password" bind:value={exportPassword} />
			</div>
			<Button variant="brand" class="w-full" disabled={!exportPassword} onclick={doExport}>{$_('backup.generateBackup')}</Button>
			{#if exportError}<p class="text-xs text-destructive">{exportError}</p>{/if}
			{#if exportResult}
				<div class="space-y-2">
					<pre class="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[10px]">{exportResult}</pre>
					<Button variant="outline" class="w-full" onclick={download}>{$_('backup.downloadBackup')}</Button>
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Import -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><IconUpload class="h-4 w-4" /> {$_('backup.import')}</CardTitle>
			<CardDescription>{$_('backup.importIntro')}</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3">
			<div class="space-y-1.5">
				<Label for="ib">{$_('backup.backupJson')}</Label>
				<textarea
					id="ib"
					bind:value={importBundle}
					rows="4"
					class="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[11px] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					placeholder={$_('backup.bundlePlaceholder')}
				></textarea>
			</div>
			<Button variant="outline" class="w-full" disabled={!importBundle} onclick={previewImport}>{$_('backup.previewProfiles')}</Button>

			{#if importPreview}
				<div class="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5">
					<div class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{$_('backup.profilesInBackup')}</div>
					{#each importPreview.profiles as name (name)}
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" checked={importSelected.has(name)} onchange={() => toggle(name)} />
							<span class="font-mono text-xs">{name}</span>
						</label>
					{/each}
				</div>
				<div class="space-y-1.5">
					<Label for="ip">{$_('backup.protectionPassword')}</Label>
					<Input id="ip" type="password" bind:value={importPassword} />
				</div>
				<Button variant="brand" class="w-full" disabled={!importPassword || importSelected.size === 0} onclick={doImport}>
					{$_('backup.importProfiles', { values: { count: importSelected.size } })}
				</Button>
			{/if}

			{#if importError}<p class="text-xs text-destructive">{importError}</p>{/if}
			{#if importDone}
				<div class="space-y-1">
					<p class="text-xs text-success">{$_('backup.imported')}</p>
					{#each importDone as u (u)}<Badge variant="success">{u}</Badge>{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
