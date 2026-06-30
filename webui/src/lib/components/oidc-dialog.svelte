<script lang="ts">
	/**
	 * OIDC Trusted Publishing 配置对话框。
	 *
	 * 承载 npm `/-/package/{name}/trust` 的增删改查（经 daemon `/api/oidc/trust`）：
	 *   - 未配置态：空表单（默认 GitHub Actions + 默认权限），提交即 POST 新增。
	 *   - 已配置态：传入的 `config` 预填表单，可改后提交（仍是 POST 新增一条；
	 *     若要替换请先删除旧条目），并提供「删除」走 DELETE。
	 *
	 * 三种 CI provider（GitHub Actions / CircleCI / GitLab CI）字段不同，按
	 * provider 切换渲染。`environment` 公共可选。提交成功后刷新外部缓存回调。
	 *
	 * 本组件不持有 token/OTP —— 那是 daemon 的职责（用当前 profile 凭证）。
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

	let {
		open = $bindable(false),
		packageName = '',
		/** 预填用的现有配置（已配置态）；undefined = 未配置态。 */
		config = undefined,
		/** 提交/删除成功后回调（外部据此刷新 hover 缓存）。 */
		onChanged = () => {},
	}: {
		open?: boolean;
		packageName?: string;
		config?: TrustedPublisherConfig | null;
		onChanged?: () => void;
	} = $props();

	const PROVIDERS: { value: TrustedPublisherType; labelKey: string }[] = [
		{ value: 'github', labelKey: 'oidc.providerGithub' },
		{ value: 'circleci', labelKey: 'oidc.providerCircleci' },
		{ value: 'gitlab', labelKey: 'oidc.providerGitlab' },
	];

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

	const isExisting = $derived(!!config);
	const configId = $derived(config?.id);

	// 打开时用 config 预填表单（environment 现在在 claims 内）
	$effect(() => {
		if (!open) return;
		error = null;
		busy = false;
		const c = config;
		provider = c?.type ?? 'github';
		// 按 type 收窄后分别读 claims 字段，避免联合类型访问报错。
		repository =
			c?.type === 'github' ? c.claims.repository : c?.type === 'circleci' ? c.claims.repository : '';
		workflowFile = c?.type === 'github' ? c.claims.workflow_ref.file : 'publish.yml';
		context = c?.type === 'circleci' ? c.claims.context ?? '' : '';
		project = c?.type === 'gitlab' ? c.claims.project : '';
		ref = c?.type === 'gitlab' ? c.claims.ref ?? '' : '';
		environment =
			c?.type === 'github'
				? c.claims.environment ?? ''
				: c?.type === 'circleci'
					? c.claims.environment ?? ''
					: c?.type === 'gitlab'
						? c.claims.environment ?? ''
						: '';
	});

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
		// permissions is required by npm; default to both publish permissions.
		const permissions: TrustedPublisherPermission[] = ['createPackage', 'createStagedPackage'];
		if (provider === 'github') {
			return {
				type: 'github',
				permissions,
				claims: { repository: repository.trim(), workflow_ref: { file: workflowFile.trim() }, ...(env ? { environment: env } : {}) },
			};
		}
		if (provider === 'circleci') {
			const ctx = context.trim() || undefined;
			return {
				type: 'circleci',
				permissions,
				claims: { repository: repository.trim(), ...(ctx ? { context: ctx } : {}), ...(env ? { environment: env } : {}) },
			};
		}
		const r = ref.trim() || undefined;
		return {
			type: 'gitlab',
			permissions,
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
			if (!json) {
				error = 'Invalid daemon response.';
				return;
			}
			if (json.ok) {
				onChanged();
				open = false;
			} else {
				error = 'Failed to configure trusted publisher.';
			}
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
			if (!json) {
				error = 'Invalid daemon response.';
				return;
			}
			if (json.ok) {
				onChanged();
				open = false;
			} else {
				error = 'Failed to remove trusted publisher.';
			}
		} catch (err) {
			error = errorToMessage(err);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="max-w-[460px]" aria-describedby={undefined}>
		<div class="space-y-1">
			<DialogTitle class="text-base">{$_('oidc.title')}</DialogTitle>
			<DialogDescription>{packageName}</DialogDescription>
		</div>

		<div class="space-y-3">
			<!-- Provider 选择 -->
			<div class="space-y-1.5">
				<Label>{$_('oidc.provider')}</Label>
				<div class="grid grid-cols-3 gap-1.5">
					{#each PROVIDERS as p (p.value)}
						<button
							type="button"
							class="rounded-md border px-2 py-1.5 text-xs transition-colors {provider === p.value
								? 'border-brand bg-brand/10 text-foreground'
								: 'border-border text-muted-foreground hover:bg-accent'}"
							onclick={() => (provider = p.value)}
							disabled={busy}
						>
							{$_(p.labelKey)}
						</button>
					{/each}
				</div>
			</div>

			<!-- 动态字段：github -->
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
				<!-- circleci -->
				<div class="space-y-1.5">
					<Label for="oidc-repo">{$_('oidc.repository')}</Label>
					<Input id="oidc-repo" bind:value={repository} placeholder="owner/name" disabled={busy} autocomplete="off" spellcheck="false" />
				</div>
				<div class="space-y-1.5">
					<Label for="oidc-ctx">{$_('oidc.context')}</Label>
					<Input id="oidc-ctx" bind:value={context} placeholder="release" disabled={busy} autocomplete="off" spellcheck="false" />
				</div>
			{:else}
				<!-- gitlab -->
				<div class="space-y-1.5">
					<Label for="oidc-proj">{$_('oidc.project')}</Label>
					<Input id="oidc-proj" bind:value={project} placeholder="group/project" disabled={busy} autocomplete="off" spellcheck="false" />
				</div>
				<div class="space-y-1.5">
					<Label for="oidc-ref">{$_('oidc.ref')}</Label>
					<Input id="oidc-ref" bind:value={ref} placeholder="main" disabled={busy} autocomplete="off" spellcheck="false" />
				</div>
			{/if}

			<!-- 公共：environment（可选） -->
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

			<div class="flex gap-2 pt-1">
				<Button variant="brand" class="flex-1" disabled={!canSubmit} onclick={submit}>
					{#if busy}<IconLoader class="h-4 w-4 animate-spin" />{/if}
					{isExisting ? $_('oidc.update') : $_('oidc.add')}
				</Button>
				{#if isExisting}
					<Button variant="outline" size="icon" title={$_('oidc.remove')} disabled={busy} onclick={remove}>
						<IconTrash class="h-4 w-4" />
					</Button>
				{/if}
			</div>
		</div>
	</DialogContent>
</Dialog>
