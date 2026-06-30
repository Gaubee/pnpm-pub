<script lang="ts">
	/**
	 * OIDC Trusted Publishing 配置对话框。
	 *
	 * Tab 布局：
	 *   - 「当前配置」tab（仅已有配置时出现）：只读展示 + 删除按钮
	 *   - GitHub Actions / CircleCI / GitLab CI tab：表单填写 + Add/Update 按钮
	 *
	 * 已有配置时默认选中「当前配置」tab；切换到其它 tab 后可填写新配置并提交。
	 * 提交/删除成功后刷新外部缓存回调。
	 */
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogTitle,
	} from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { errorToMessage } from '$lib/error-projection.js';
	import { parseOkResponse } from '$lib/rest-response.js';
	import { apiFetch } from '$lib/api-fetch.js';
	import type {
		TrustedPublisherConfig,
		TrustedPublisherPermission,
		TrustedPublisherType,
	} from '$lib/types.js';
	import { _ } from 'svelte-i18n';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconAlert from '@lucide/svelte/icons/triangle-alert';
	import IconTrash from '@lucide/svelte/icons/trash-2';
	import IconShield from '@lucide/svelte/icons/shield-check';

	let {
		open = $bindable(false),
		packageName = '',
		config = undefined,
		onChanged = () => {},
	}: {
		open?: boolean;
		packageName?: string;
		config?: TrustedPublisherConfig | null;
		onChanged?: () => void;
	} = $props();

	type Tab = 'current' | TrustedPublisherType;

	const PROVIDERS: { value: TrustedPublisherType; labelKey: string }[] = [
		{ value: 'github', labelKey: 'oidc.providerGithub' },
		{ value: 'circleci', labelKey: 'oidc.providerCircleci' },
		{ value: 'gitlab', labelKey: 'oidc.providerGitlab' },
	];

	const isExisting = $derived(!!config);
	const configId = $derived(config?.id);

	// 当前选中的 tab
	let activeTab = $state<Tab>('github');

	// 表单字段
	let provider = $state<TrustedPublisherType>('github');
	let repository = $state('');
	let workflowFile = $state('publish.yml');
	let context = $state('');
	let project = $state('');
	let ref = $state('');
	let environment = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	// 打开时初始化：已有配置默认选 current tab，否则 github tab
	$effect(() => {
		if (!open) return;
		error = null;
		busy = false;
		activeTab = isExisting ? 'current' : 'github';
		provider = 'github';
		repository = '';
		workflowFile = 'publish.yml';
		context = '';
		project = '';
		ref = '';
		environment = '';
	});

	// 切到 provider tab 时同步 provider 状态
	function selectTab(tab: Tab): void {
		activeTab = tab;
		if (tab !== 'current') provider = tab;
	}

	const canSubmit = $derived(
		!busy &&
			packageName.trim().length > 0 &&
			(provider === 'github'
				? repository.trim().length > 0 && workflowFile.trim().length > 0
				: provider === 'circleci'
					? repository.trim().length > 0
					: provider === 'gitlab'
						? project.trim().length > 0
						: false),
	);

	function buildConfig(): TrustedPublisherConfig {
		const env = environment.trim() || undefined;
		const permissions: TrustedPublisherPermission[] = ['createPackage', 'createStagedPackage'];
		if (provider === 'github') {
			return {
				type: 'github', permissions,
				claims: { repository: repository.trim(), workflow_ref: { file: workflowFile.trim() }, ...(env ? { environment: env } : {}) },
			};
		}
		if (provider === 'circleci') {
			const ctx = context.trim() || undefined;
			return {
				type: 'circleci', permissions,
				claims: { repository: repository.trim(), ...(ctx ? { context: ctx } : {}), ...(env ? { environment: env } : {}) },
			};
		}
		const r = ref.trim() || undefined;
		return {
			type: 'gitlab', permissions,
			claims: { project: project.trim(), ...(r ? { ref: r } : {}), ...(env ? { environment: env } : {}) },
		};
	}

	async function submit(): Promise<void> {
		if (busy || !canSubmit) return;
		busy = true;
		error = null;
		try {
			const res = await apiFetch('/api/oidc/trust', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ package: packageName.trim(), config: buildConfig() }),
			});
			const json = parseOkResponse(await res.json());
			if (!json) { error = 'Invalid daemon response.'; return; }
			if (json.ok) { onChanged(); open = false; }
			else { error = 'Failed to configure trusted publisher.'; }
		} catch (err) {
			error = errorToMessage(err);
		} finally {
			busy = false;
		}
	}

	async function remove(): Promise<void> {
		if (busy || !configId) return;
		busy = true;
		error = null;
		try {
			const res = await apiFetch('/api/oidc/trust', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ package: packageName.trim(), uuid: configId }),
			});
			const json = parseOkResponse(await res.json());
			if (!json) { error = 'Invalid daemon response.'; return; }
			if (json.ok) { onChanged(); open = false; }
			else { error = 'Failed to remove trusted publisher.'; }
		} catch (err) {
			error = errorToMessage(err);
		} finally {
			busy = false;
		}
	}

	/** 只读展示已有配置的字段摘要 */
	const configSummary = $derived.by(() => {
		const c = config;
		if (!c) return [];
		const rows: { label: string; value: string }[] = [{ label: 'Type', value: c.type }];
		if (c.type === 'github') {
			rows.push({ label: 'Repository', value: c.claims.repository });
			rows.push({ label: 'Workflow', value: c.claims.workflow_ref.file });
		} else if (c.type === 'circleci') {
			rows.push({ label: 'Repository', value: c.claims.repository });
			if (c.claims.context) rows.push({ label: 'Context', value: c.claims.context });
		} else {
			rows.push({ label: 'Project', value: c.claims.project });
			if (c.claims.ref) rows.push({ label: 'Ref', value: c.claims.ref });
		}
		if (c.claims.environment) rows.push({ label: 'Environment', value: c.claims.environment });
		if (c.id) rows.push({ label: 'ID', value: c.id.slice(0, 8) + '…' });
		return rows;
	});
</script>

<Dialog bind:open>
	<DialogContent class="max-w-[460px]" aria-describedby={undefined}>
		<div class="space-y-1">
			<DialogTitle class="text-base">{$_('oidc.title')}</DialogTitle>
			<DialogDescription>{packageName}</DialogDescription>
		</div>

		<!-- Tabs -->
		<div class="flex gap-1 border-b border-border">
			{#if isExisting}
				<button
					type="button"
					class="border-b-2 px-3 py-1.5 text-xs font-medium transition-colors {activeTab === 'current' ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
					onclick={() => selectTab('current')}
				>
					<IconShield class="mr-1 inline h-3 w-3" />{$_('oidc.currentConfig')}
				</button>
			{/if}
			{#each PROVIDERS as p (p.value)}
				<button
					type="button"
					class="border-b-2 px-3 py-1.5 text-xs font-medium transition-colors {activeTab === p.value ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
					onclick={() => selectTab(p.value)}
				>
					{$_(p.labelKey)}
				</button>
			{/each}
		</div>

		<div class="space-y-3">
			{#if activeTab === 'current'}
				<!-- 当前配置只读展示 -->
				<div class="space-y-2">
					{#each configSummary as row (row.label)}
						<div class="flex items-center justify-between gap-2 text-xs">
							<span class="text-muted-foreground">{row.label}</span>
							<span class="truncate font-mono">{row.value}</span>
						</div>
					{/each}
				</div>

				{#if error}
					<div class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
						<IconAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<div class="break-words">{error}</div>
					</div>
				{/if}

				<Button variant="destructive" class="w-full" disabled={busy} onclick={remove}>
					{#if busy}<IconLoader class="h-4 w-4 animate-spin" />{/if}
					<IconTrash class="h-4 w-4" /> {$_('oidc.remove')}
				</Button>

			{:else}
				<!-- provider 表单 -->
				{#if provider === 'github'}
					<div class="space-y-1.5">
						<Label for="oidc-repo">{$_('oidc.repository')}</Label>
						<Input id="oidc-repo" bind:value={repository} placeholder="owner/name" disabled={busy} autocomplete="off" spellcheck="false" />
					</div>
					<div class="space-y-1.5">
						<Label for="oidc-wf">{$_('oidc.workflowFile')}</Label>
						<Input id="oidc-wf" bind:value={workflowFile} placeholder="publish.yml" disabled={busy} autocomplete="off" spellcheck="false" />
					</div>
				{:else if provider === 'circleci'}
					<div class="space-y-1.5">
						<Label for="oidc-repo">{$_('oidc.repository')}</Label>
						<Input id="oidc-repo" bind:value={repository} placeholder="owner/name" disabled={busy} autocomplete="off" spellcheck="false" />
					</div>
					<div class="space-y-1.5">
						<Label for="oidc-ctx">{$_('oidc.context')}</Label>
						<Input id="oidc-ctx" bind:value={context} placeholder="release" disabled={busy} autocomplete="off" spellcheck="false" />
					</div>
				{:else}
					<div class="space-y-1.5">
						<Label for="oidc-proj">{$_('oidc.project')}</Label>
						<Input id="oidc-proj" bind:value={project} placeholder="group/project" disabled={busy} autocomplete="off" spellcheck="false" />
					</div>
					<div class="space-y-1.5">
						<Label for="oidc-ref">{$_('oidc.ref')}</Label>
						<Input id="oidc-ref" bind:value={ref} placeholder="main" disabled={busy} autocomplete="off" spellcheck="false" />
					</div>
				{/if}

				<div class="space-y-1.5">
					<Label for="oidc-env">{$_('oidc.environment')} <span class="font-normal text-muted-foreground">({$_('common.optional')})</span></Label>
					<Input id="oidc-env" bind:value={environment} placeholder="release" disabled={busy} autocomplete="off" spellcheck="false" />
				</div>

				{#if error}
					<div class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
						<IconAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<div class="break-words">{error}</div>
					</div>
				{/if}

				<Button variant="brand" class="w-full" disabled={!canSubmit} onclick={submit}>
					{#if busy}<IconLoader class="h-4 w-4 animate-spin" />{/if}
					{$_('oidc.add')}
				</Button>
			{/if}
		</div>
	</DialogContent>
</Dialog>
