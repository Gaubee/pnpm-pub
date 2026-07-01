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
	 *
	 * 表单使用 human-friendly 的分字段（GitHub owner + name 分两栏、GitLab
	 * namespace + projectName 分两栏），提交前在 buildConfig() 里拼成 npm
	 * registry 的 wire format（repository = owner/name 等）。
	 *
	 * 批量模式：传入 packageNames（数组）时，提交会逐个配置所有包。
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
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { errorToMessage } from '$lib/error-projection.js';
	import { parseOkResponse } from '$lib/rest-response.js';
	import { apiFetch } from '$lib/api-fetch.js';
	import type {
		TrustedPublisherConfig,
		TrustedPublisherPermission,
		TrustedPublisherType,
	} from '$lib/types.js';
	import { _ } from 'svelte-i18n';
	import { get } from 'svelte/store';
	import IconLoader from '@lucide/svelte/icons/loader-circle';
	import IconAlert from '@lucide/svelte/icons/triangle-alert';
	import IconTrash from '@lucide/svelte/icons/trash-2';
	import IconShield from '@lucide/svelte/icons/shield-check';

	let {
		open = $bindable(false),
		packageName = '',
		/** 批量模式：传入多个包名；单包模式留空（用 packageName）。 */
		packageNames = undefined,
		config = undefined,
		onChanged = () => {},
		/** Repository hint from the package's git metadata (e.g. "owner/name" or "gitlab.com/group/proj"). */
		repositoryHint = '',
	}: {
		open?: boolean;
		packageName?: string;
		packageNames?: string[];
		config?: TrustedPublisherConfig | null;
		onChanged?: () => void;
		repositoryHint?: string;
	} = $props();

	type Tab = 'current' | TrustedPublisherType;

	const PROVIDERS: { value: TrustedPublisherType; labelKey: string }[] = [
		{ value: 'github', labelKey: 'oidc.providerGithub' },
		{ value: 'circleci', labelKey: 'oidc.providerCircleci' },
		{ value: 'gitlab', labelKey: 'oidc.providerGitlab' },
	];

	const isExisting = $derived(!!config);
	const configId = $derived(config?.id);
	const isBatch = $derived(!!packageNames && packageNames.length > 0);
	/** Names to configure — all packages in batch mode, otherwise the single name. */
	const effectiveNames = $derived.by((): string[] => {
		if (packageNames && packageNames.length > 0) return packageNames.filter((n) => n.trim().length > 0);
		return packageName.trim() ? [packageName.trim()] : [];
	});
	const subjectLabel = $derived(
		isBatch ? get(_)('oidc.batchTitle', { values: { n: effectiveNames.length } }) : packageName,
	);

	// 当前选中的 tab
	let activeTab = $state<Tab>('github');

	// 表单字段（human-friendly 分字段）
	let provider = $state<TrustedPublisherType>('github');
	// GitHub / GitLab 共用的 owner+name 拆分
	let repoOwner = $state('');
	let repoName = $state('');
	let workflowFile = $state('');
	// GitLab
	let ciFilePath = $state('');
	// CircleCI（wire format 用带点的 claim 键）
	let orgId = $state('');
	let circleProjectId = $state('');
	let pipelineDefinitionId = $state('');
	let contextIds = $state(''); // 逗号分隔
	let vcsOrigin = $state('');
	// 通用
	let environment = $state('');
	// 权限开关
	let allowPublish = $state(true);
	let allowStagePublish = $state(true);

	let busy = $state(false);
	let error = $state<string | null>(null);
	let progress = $state<{ i: number; n: number } | null>(null);

	/** Detect provider + repo from repositoryHint (github.com / gitlab.com / plain owner/name). */
	const inferredProvider = $derived.by((): TrustedPublisherType => {
		const h = repositoryHint.toLowerCase();
		if (h.includes('gitlab.com') || h.startsWith('gl:')) return 'gitlab';
		if (h.includes('circleci')) return 'circleci';
		return 'github'; // default (covers github.com / owner/name)
	});
	/** owner / name 拆分（GitHub 与 GitLab 复用）。 */
	const inferredOwner = $derived.by((): string => {
		const h = repositoryHint.trim();
		if (!h) return '';
		const m = h.match(/(?:github\.com|gitlab\.com)[:/](.+?)(?:\.git)?$/i);
		const path = m?.[1] ? m[1].replace(/^\/+/, '') : /^[\w.-]+\/[\w.-]+$/.test(h) ? h : '';
		const slash = path.indexOf('/');
		return slash >= 0 ? path.slice(0, slash) : path;
	});
	const inferredName = $derived.by((): string => {
		const h = repositoryHint.trim();
		if (!h) return '';
		const m = h.match(/(?:github\.com|gitlab\.com)[:/](.+?)(?:\.git)?$/i);
		const path = m?.[1] ? m[1].replace(/^\/+/, '') : /^[\w.-]+\/[\w.-]+$/.test(h) ? h : '';
		const slash = path.indexOf('/');
		return slash >= 0 ? path.slice(slash + 1) : '';
	});

	// 打开时初始化：已有配置默认选 current tab，否则推断 tab。
	// 表单字段优先用已有配置预填；无配置时用 repositoryHint 推断。
	$effect(() => {
		if (!open) return;
		error = null;
		busy = false;
		progress = null;
		const c = config;
		if (c) {
			activeTab = 'current';
			prefillFromConfig(c);
		} else {
			// 无已有配置：根据 repositoryHint 推断 provider + 字段
			activeTab = inferredProvider;
			provider = inferredProvider;
			prefillFromHint();
		}
	});

	function resetFields(): void {
		repoOwner = '';
		repoName = '';
		workflowFile = '';
		ciFilePath = '';
		orgId = '';
		circleProjectId = '';
		pipelineDefinitionId = '';
		contextIds = '';
		vcsOrigin = '';
		environment = '';
		allowPublish = true;
		allowStagePublish = true;
	}

	/** 用已有 wire-format 配置回填分字段。 */
	function prefillFromConfig(c: TrustedPublisherConfig): void {
		provider = c.type;
		resetFields();
		if (c.type === 'github') {
			const [o, ...rest] = c.claims.repository.split('/');
			repoOwner = o ?? '';
			repoName = rest.join('/');
			workflowFile = c.claims.workflow_ref.file;
			environment = c.claims.environment ?? '';
		} else if (c.type === 'gitlab') {
			const [ns, ...rest] = c.claims.project_path.split('/');
			repoOwner = ns ?? '';
			repoName = rest.join('/');
			ciFilePath = c.claims.ci_config_ref_uri ?? '';
			environment = c.claims.environment ?? '';
		} else {
			orgId = c.claims['oidc.circleci.com/org-id'];
			circleProjectId = c.claims['oidc.circleci.com/project-id'];
			pipelineDefinitionId = c.claims['oidc.circleci.com/pipeline-definition-id'];
			contextIds = (c.claims['oidc.circleci.com/context-ids'] ?? []).join(', ');
			vcsOrigin = c.claims['oidc.circleci.com/vcs-origin'];
		}
	}

	/** 用 repositoryHint 推断 provider + owner/name 等字段。 */
	function prefillFromHint(): void {
		resetFields();
		repoOwner = inferredOwner;
		repoName = inferredName;
		if (inferredProvider === 'gitlab') {
			ciFilePath = '.gitlab-ci.yml';
		} else if (inferredProvider === 'github') {
			workflowFile = '';
		}
	}

	// 切到 provider tab 时同步 provider 状态
	function selectTab(tab: Tab): void {
		activeTab = tab;
		if (tab !== 'current') provider = tab;
	}

	const permissions = $derived.by((): TrustedPublisherPermission[] => {
		const perms: TrustedPublisherPermission[] = [];
		if (allowPublish) perms.push('createPackage');
		if (allowStagePublish) perms.push('createStagedPackage');
		return perms;
	});

	const canSubmit = $derived.by(() => {
		if (busy || effectiveNames.length === 0 || permissions.length === 0) return false;
		if (provider === 'github') return repoOwner.trim() && repoName.trim() && workflowFile.trim();
		if (provider === 'gitlab') return repoOwner.trim() && repoName.trim();
		if (provider === 'circleci')
			return orgId.trim() && circleProjectId.trim() && pipelineDefinitionId.trim() && vcsOrigin.trim();
		return false;
	});

	/** 组装 wire-format 配置（human-friendly 分字段 → registry 字段）。 */
	function buildConfig(): TrustedPublisherConfig {
		const env = environment.trim() || undefined;
		const perms = permissions;
		if (provider === 'github') {
			return {
				type: 'github',
				permissions: perms,
				claims: {
					repository: `${repoOwner.trim()}/${repoName.trim()}`,
					workflow_ref: { file: workflowFile.trim() },
					...(env ? { environment: env } : {}),
				},
			};
		}
		if (provider === 'gitlab') {
			return {
				type: 'gitlab',
				permissions: perms,
				claims: {
					project_path: `${repoOwner.trim()}/${repoName.trim()}`,
					...(ciFilePath.trim() ? { ci_config_ref_uri: ciFilePath.trim() } : {}),
					...(env ? { environment: env } : {}),
				},
			};
		}
		// circleci
		const ctx = contextIds
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		return {
			type: 'circleci',
			permissions: perms,
			claims: {
				'oidc.circleci.com/org-id': orgId.trim(),
				'oidc.circleci.com/project-id': circleProjectId.trim(),
				'oidc.circleci.com/pipeline-definition-id': pipelineDefinitionId.trim(),
				...(ctx.length ? { 'oidc.circleci.com/context-ids': ctx } : {}),
				'oidc.circleci.com/vcs-origin': vcsOrigin.trim(),
			},
		};
	}

	async function postConfig(pkg: string, cfg: TrustedPublisherConfig): Promise<boolean> {
		const res = await apiFetch('/api/oidc/trust', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ package: pkg, config: cfg }),
		});
		const json = parseOkResponse(await res.json());
		if (!json) throw new Error('Invalid daemon response.');
		if (!json.ok) throw new Error('Failed to configure trusted publisher.');
		return true;
	}

	async function submit(): Promise<void> {
		if (busy || !canSubmit) return;
		busy = true;
		error = null;
		const names = effectiveNames;
		const cfg = buildConfig();
		try {
			if (names.length === 1) {
				await postConfig(names[0]!, cfg);
			} else {
				// 批量：串行配置，任一失败即停止。
				for (let i = 0; i < names.length; i++) {
					progress = { i: i + 1, n: names.length };
					await postConfig(names[i]!, cfg);
				}
				progress = null;
			}
			onChanged();
			open = false;
		} catch (err) {
			error = errorToMessage(err);
		} finally {
			busy = false;
			progress = null;
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
		} else if (c.type === 'gitlab') {
			rows.push({ label: 'Project path', value: c.claims.project_path });
			if (c.claims.ci_config_ref_uri) rows.push({ label: 'CI file', value: c.claims.ci_config_ref_uri });
		} else {
			rows.push({ label: 'Org ID', value: c.claims['oidc.circleci.com/org-id'] });
			rows.push({ label: 'Project ID', value: c.claims['oidc.circleci.com/project-id'] });
			rows.push({ label: 'VCS origin', value: c.claims['oidc.circleci.com/vcs-origin'] });
		}
		if ('environment' in c.claims && c.claims.environment) rows.push({ label: 'Environment', value: c.claims.environment });
		if (c.id) rows.push({ label: 'ID', value: c.id.slice(0, 8) + '…' });
		return rows;
	});
</script>

<Dialog bind:open>
	<DialogContent class="max-w-[480px]" aria-describedby={undefined}>
		<div class="space-y-1">
			<DialogTitle class="text-base">{$_('oidc.title')}</DialogTitle>
			<DialogDescription>{subjectLabel}</DialogDescription>
		</div>

		<!-- Tabs -->
		<div class="flex gap-1 border-b border-border">
			{#if isExisting && !isBatch}
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
					<!-- GitHub: Organization or user / Repository name 分两栏 -->
					<div class="flex items-end gap-2">
						<div class="flex-1 space-y-1.5">
							<Label for="oidc-owner">{$_('oidc.repositoryOwner')}</Label>
							<Input id="oidc-owner" bind:value={repoOwner} placeholder="owner" disabled={busy} autocomplete="organization" spellcheck="false" />
						</div>
						<span class="pb-2.5 text-muted-foreground">/</span>
						<div class="flex-1 space-y-1.5">
							<Label for="oidc-name">{$_('oidc.repositoryName')}</Label>
							<Input id="oidc-name" bind:value={repoName} placeholder="name" disabled={busy} autocomplete="organization" spellcheck="false" />
						</div>
					</div>
					<div class="space-y-1.5">
						<Label for="oidc-wf">{$_('oidc.workflowFilename')}</Label>
						<Input id="oidc-wf" bind:value={workflowFile} placeholder={$_('oidc.workflowFilePlaceholder')} disabled={busy} autocomplete="on" spellcheck="false" />
						<p class="text-[11px] text-muted-foreground">{$_('oidc.workflowFileHelp')}</p>
					</div>
				{:else if provider === 'gitlab'}
					<!-- GitLab: Namespace / Project name 分两栏 -->
					<div class="flex items-end gap-2">
						<div class="flex-1 space-y-1.5">
							<Label for="oidc-ns">{$_('oidc.namespace')}</Label>
							<Input id="oidc-ns" bind:value={repoOwner} placeholder="group" disabled={busy} autocomplete="organization" spellcheck="false" />
						</div>
						<span class="pb-2.5 text-muted-foreground">/</span>
						<div class="flex-1 space-y-1.5">
							<Label for="oidc-proj">{$_('oidc.projectName')}</Label>
							<Input id="oidc-proj" bind:value={repoName} placeholder="project" disabled={busy} autocomplete="organization" spellcheck="false" />
						</div>
					</div>
					<div class="space-y-1.5">
						<Label for="oidc-ci">{$_('oidc.ciFilePath')}</Label>
						<Input id="oidc-ci" bind:value={ciFilePath} placeholder={$_('oidc.ciFilePathPlaceholder')} disabled={busy} autocomplete="on" spellcheck="false" />
						<p class="text-[11px] text-muted-foreground">{$_('oidc.ciFilePathHelp')}</p>
					</div>
				{:else}
					<!-- CircleCI: wire-format dotted claim keys -->
					<div class="space-y-1.5">
						<Label for="oidc-orgid">{$_('oidc.orgId')}</Label>
						<Input id="oidc-orgid" bind:value={orgId} placeholder="00000000-0000-0000-0000-000000000000" disabled={busy} autocomplete="off" spellcheck="false" />
						<p class="text-[11px] text-muted-foreground">{$_('oidc.orgIdHelp')}</p>
					</div>
					<div class="space-y-1.5">
						<Label for="oidc-projid">{$_('oidc.projectId')}</Label>
						<Input id="oidc-projid" bind:value={circleProjectId} placeholder="00000000-0000-0000-0000-000000000000" disabled={busy} autocomplete="off" spellcheck="false" />
						<p class="text-[11px] text-muted-foreground">{$_('oidc.projectIdHelp')}</p>
					</div>
					<div class="space-y-1.5">
						<Label for="oidc-pdef">{$_('oidc.pipelineDefinitionId')}</Label>
						<Input id="oidc-pdef" bind:value={pipelineDefinitionId} placeholder="00000000-0000-0000-0000-000000000000" disabled={busy} autocomplete="off" spellcheck="false" />
						<p class="text-[11px] text-muted-foreground">{$_('oidc.pipelineDefHelp')}</p>
					</div>
					<div class="space-y-1.5">
						<Label for="oidc-ctx">{$_('oidc.contextIds')} <span class="font-normal text-muted-foreground">({$_('common.optional')})</span></Label>
						<Input id="oidc-ctx" bind:value={contextIds} placeholder={$_('oidc.contextIdsPlaceholder')} disabled={busy} autocomplete="off" spellcheck="false" />
						<p class="text-[11px] text-muted-foreground">{$_('oidc.contextIdsHelp')}</p>
					</div>
					<div class="space-y-1.5">
						<Label for="oidc-vcs">{$_('oidc.vcsOrigin')}</Label>
						<Input id="oidc-vcs" bind:value={vcsOrigin} placeholder="github.com/myorg/myrepo" disabled={busy} autocomplete="off" spellcheck="false" />
						<p class="text-[11px] text-muted-foreground">{$_('oidc.vcsOriginHelp')}</p>
					</div>
				{/if}

				<!-- 通用 environment（GitHub / GitLab） -->
				{#if provider === 'github' || provider === 'gitlab'}
					<div class="space-y-1.5">
						<Label for="oidc-env">{$_('oidc.environment')} <span class="font-normal text-muted-foreground">({$_('common.optional')})</span></Label>
						<Input id="oidc-env" bind:value={environment} placeholder="release" disabled={busy} autocomplete="on" spellcheck="false" />
						<p class="text-[11px] text-muted-foreground">{$_('oidc.environmentHelp')}</p>
					</div>
				{/if}

				<!-- Allowed actions 开关组 -->
				<div class="space-y-2 rounded-md border border-border p-3">
					<div class="space-y-0.5">
						<p class="text-xs font-semibold">{$_('oidc.allowedActions')} <span class="text-destructive">*</span></p>
						<p class="text-[11px] text-muted-foreground">{$_('oidc.allowedActionsDesc')}</p>
					</div>
					<label class="flex items-center justify-between gap-3 text-xs" for="oidc-allow-publish">
						<span class="font-mono">npm publish</span>
						<Switch id="oidc-allow-publish" bind:checked={allowPublish} disabled={busy} />
					</label>
					<label class="flex items-center justify-between gap-3 text-xs" for="oidc-allow-stage">
						<span class="font-mono">npm stage publish</span>
						<Switch id="oidc-allow-stage" bind:checked={allowStagePublish} disabled={busy} />
					</label>
					{#if permissions.length === 0}
						<p class="text-[11px] text-destructive">{$_('oidc.atLeastOneAction')}</p>
					{/if}
				</div>

				{#if error}
					<div class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
						<IconAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<div class="break-words">{error}</div>
					</div>
				{/if}

				<Button variant="brand" class="w-full" disabled={!canSubmit} onclick={submit}>
					{#if busy}<IconLoader class="h-4 w-4 animate-spin" />{/if}
					{#if progress}
						{$_('oidc.batchProgress', { values: { i: progress.i, n: progress.n } })}
					{:else}
						{$_('oidc.add')}
					{/if}
				</Button>
			{/if}
		</div>
	</DialogContent>
</Dialog>
