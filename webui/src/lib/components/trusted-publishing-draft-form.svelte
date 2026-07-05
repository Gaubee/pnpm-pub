<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { LabelInput } from '$lib/components/spell/label-input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { actions } from '$lib/store.js';
	import {
		configPermissions,
		permissionsFromBooleans,
		providerFromHint,
		splitRepositoryHint,
	} from '$lib/trusted-publishing.js';
	import { _ } from 'svelte-i18n';
	import type {
		TrustedPublisherConfig,
		TrustedPublisherCreateConfig,
		TrustedPublisherType,
	} from '$lib/types.js';

	let {
		eventId,
		groupId = undefined,
		config = undefined,
		currentConfig = undefined,
		repositoryHint = '',
		mode = 'full',
		disabled = false,
		valid = $bindable(false),
	}: {
		eventId: string;
		groupId?: string;
		config?: TrustedPublisherCreateConfig;
		currentConfig?: TrustedPublisherConfig;
		repositoryHint?: string;
		mode?: 'full' | 'compact';
		disabled?: boolean;
		valid?: boolean;
	} = $props();

	const providers: { value: TrustedPublisherType; labelKey: string }[] = [
		{ value: 'github', labelKey: 'trustedPublishing.providerGithub' },
		{ value: 'circleci', labelKey: 'trustedPublishing.providerCircleci' },
		{ value: 'gitlab', labelKey: 'trustedPublishing.providerGitlab' },
	];

	let provider = $state<TrustedPublisherType>('github');
	let repoOwner = $state('');
	let repoName = $state('');
	let workflowFile = $state('');
	let ciFilePath = $state('');
	let orgId = $state('');
	let circleProjectId = $state('');
	let pipelineDefinitionId = $state('');
	let contextIds = $state('');
	let vcsOrigin = $state('');
	let environment = $state('');
	let allowPublish = $state(true);
	let allowStagePublish = $state(true);
	let initializedKey = '';
	let sentKey = '';

	function reset(): void {
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

	function prefillFromConfig(source: TrustedPublisherConfig | TrustedPublisherCreateConfig): void {
		provider = source.type;
		reset();
		const permissions = configPermissions(source);
		allowPublish = permissions.allowPublish;
		allowStagePublish = permissions.allowStagePublish;
		if (source.type === 'github') {
			const [owner, ...rest] = source.claims.repository.split('/');
			repoOwner = owner ?? '';
			repoName = rest.join('/');
			workflowFile = source.claims.workflow_ref.file;
			environment = source.claims.environment ?? '';
		} else if (source.type === 'gitlab') {
			const [owner, ...rest] = source.claims.project_path.split('/');
			repoOwner = owner ?? '';
			repoName = rest.join('/');
			ciFilePath = source.claims.ci_config_ref_uri ?? '';
			environment = source.claims.environment ?? '';
		} else {
			orgId = source.claims['oidc.circleci.com/org-id'];
			circleProjectId = source.claims['oidc.circleci.com/project-id'];
			pipelineDefinitionId = source.claims['oidc.circleci.com/pipeline-definition-id'];
			contextIds = (source.claims['oidc.circleci.com/context-ids'] ?? []).join(', ');
			vcsOrigin = source.claims['oidc.circleci.com/vcs-origin'];
		}
	}

	function prefillFromHint(): void {
		reset();
		provider = providerFromHint(repositoryHint);
		const repo = splitRepositoryHint(repositoryHint);
		repoOwner = repo.owner;
		repoName = repo.name;
		if (provider === 'gitlab') ciFilePath = '.gitlab-ci.yml';
	}

	$effect(() => {
		const key = `${eventId}:${JSON.stringify(config ?? currentConfig ?? null)}:${repositoryHint}`;
		if (initializedKey === key) return;
		initializedKey = key;
		sentKey = '';
		if (config) prefillFromConfig(config);
		else if (currentConfig) prefillFromConfig(currentConfig);
		else prefillFromHint();
	});

	const builtConfig = $derived.by((): TrustedPublisherCreateConfig | null => {
		const permissions = permissionsFromBooleans(allowPublish, allowStagePublish);
		if (permissions.length === 0) return null;
		const env = environment.trim() || undefined;
		if (provider === 'github') {
			if (!repoOwner.trim() || !repoName.trim() || !workflowFile.trim()) return null;
			return {
				type: 'github',
				permissions,
				claims: {
					repository: `${repoOwner.trim()}/${repoName.trim()}`,
					workflow_ref: { file: workflowFile.trim() },
					...(env ? { environment: env } : {}),
				},
			};
		}
		if (provider === 'gitlab') {
			if (!repoOwner.trim() || !repoName.trim()) return null;
			return {
				type: 'gitlab',
				permissions,
				claims: {
					project_path: `${repoOwner.trim()}/${repoName.trim()}`,
					...(ciFilePath.trim() ? { ci_config_ref_uri: ciFilePath.trim() } : {}),
					...(env ? { environment: env } : {}),
				},
			};
		}
		if (!orgId.trim() || !circleProjectId.trim() || !pipelineDefinitionId.trim() || !vcsOrigin.trim()) {
			return null;
		}
		const contexts = contextIds
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean);
		return {
			type: 'circleci',
			permissions,
			claims: {
				'oidc.circleci.com/org-id': orgId.trim(),
				'oidc.circleci.com/project-id': circleProjectId.trim(),
				'oidc.circleci.com/pipeline-definition-id': pipelineDefinitionId.trim(),
				...(contexts.length ? { 'oidc.circleci.com/context-ids': contexts } : {}),
				'oidc.circleci.com/vcs-origin': vcsOrigin.trim(),
			},
		};
	});

	$effect(() => {
		valid = !!builtConfig;
		if (!builtConfig) return;
		const key = JSON.stringify(builtConfig);
		if (sentKey === key) return;
		sentKey = key;
		if (groupId) actions.updateConfigureTrustGroupDraft(groupId, builtConfig);
		else actions.updateConfigureTrustDraft(eventId, builtConfig);
	});
</script>

<div class="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
	<div class="flex flex-wrap gap-1">
		{#each providers as item (item.value)}
			<Button
				type="button"
				size="sm"
				variant={provider === item.value ? 'brand' : 'outline'}
				disabled={disabled}
				onclick={() => (provider = item.value)}
			>
				{$_(item.labelKey)}
			</Button>
		{/each}
	</div>

	{#if mode === 'compact'}
		{#if provider === 'github'}
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
				<LabelInput id={`${eventId}-compact-owner`} label={$_('trustedPublishing.repositoryOwner')} bind:value={repoOwner} disabled={disabled} spellcheck="false" />
				<LabelInput id={`${eventId}-compact-repo`} label={$_('trustedPublishing.repositoryName')} bind:value={repoName} disabled={disabled} spellcheck="false" />
				<LabelInput id={`${eventId}-compact-workflow`} label={$_('trustedPublishing.workflowFilename')} bind:value={workflowFile} placeholder={$_('trustedPublishing.workflowFilePlaceholder')} disabled={disabled} spellcheck="false" />
			</div>
		{:else if provider === 'gitlab'}
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
				<LabelInput id={`${eventId}-compact-namespace`} label={$_('trustedPublishing.namespace')} bind:value={repoOwner} disabled={disabled} spellcheck="false" />
				<LabelInput id={`${eventId}-compact-project`} label={$_('trustedPublishing.projectName')} bind:value={repoName} disabled={disabled} spellcheck="false" />
				<LabelInput id={`${eventId}-compact-ci`} label={$_('trustedPublishing.ciFilePath')} bind:value={ciFilePath} placeholder={$_('trustedPublishing.ciFilePathPlaceholder')} disabled={disabled} spellcheck="false" />
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				<LabelInput id={`${eventId}-compact-org`} label={$_('trustedPublishing.orgId')} bind:value={orgId} disabled={disabled} spellcheck="false" />
				<LabelInput id={`${eventId}-compact-project-id`} label={$_('trustedPublishing.projectId')} bind:value={circleProjectId} disabled={disabled} spellcheck="false" />
				<LabelInput id={`${eventId}-compact-pipeline`} label={$_('trustedPublishing.pipelineDefinitionId')} bind:value={pipelineDefinitionId} disabled={disabled} spellcheck="false" />
				<LabelInput id={`${eventId}-compact-vcs`} label={$_('trustedPublishing.vcsOrigin')} bind:value={vcsOrigin} placeholder="github.com/owner/repo" disabled={disabled} spellcheck="false" />
				<LabelInput id={`${eventId}-compact-contexts`} label={$_('trustedPublishing.contextIds')} bind:value={contextIds} placeholder={$_('trustedPublishing.contextIdsPlaceholder')} disabled={disabled} spellcheck="false" />
			</div>
		{/if}

		{#if provider === 'github' || provider === 'gitlab'}
			<LabelInput id={`${eventId}-compact-environment`} label={$_('trustedPublishing.environment')} bind:value={environment} placeholder="release" disabled={disabled} spellcheck="false" />
		{/if}
	{:else if provider === 'github'}
		<div class="flex items-end gap-2">
			<div class="flex-1">
				<Label for={`${eventId}-owner`}>{$_('trustedPublishing.repositoryOwner')}</Label>
				<Input id={`${eventId}-owner`} bind:value={repoOwner} disabled={disabled} spellcheck="false" />
			</div>
			<span class="pb-2 text-muted-foreground">/</span>
			<div class="flex-1">
				<Label for={`${eventId}-repo`}>{$_('trustedPublishing.repositoryName')}</Label>
				<Input id={`${eventId}-repo`} bind:value={repoName} disabled={disabled} spellcheck="false" />
			</div>
		</div>
		<div>
			<Label for={`${eventId}-workflow`}>{$_('trustedPublishing.workflowFilename')}</Label>
			<Input id={`${eventId}-workflow`} bind:value={workflowFile} placeholder={$_('trustedPublishing.workflowFilePlaceholder')} disabled={disabled} spellcheck="false" />
		</div>
	{:else if provider === 'gitlab'}
		<div class="flex items-end gap-2">
			<div class="flex-1">
				<Label for={`${eventId}-namespace`}>{$_('trustedPublishing.namespace')}</Label>
				<Input id={`${eventId}-namespace`} bind:value={repoOwner} disabled={disabled} spellcheck="false" />
			</div>
			<span class="pb-2 text-muted-foreground">/</span>
			<div class="flex-1">
				<Label for={`${eventId}-project`}>{$_('trustedPublishing.projectName')}</Label>
				<Input id={`${eventId}-project`} bind:value={repoName} disabled={disabled} spellcheck="false" />
			</div>
		</div>
		<div>
			<Label for={`${eventId}-ci`}>{$_('trustedPublishing.ciFilePath')}</Label>
			<Input id={`${eventId}-ci`} bind:value={ciFilePath} placeholder={$_('trustedPublishing.ciFilePathPlaceholder')} disabled={disabled} spellcheck="false" />
		</div>
	{:else}
		<div>
			<Label for={`${eventId}-org`}>{$_('trustedPublishing.orgId')}</Label>
			<Input id={`${eventId}-org`} bind:value={orgId} disabled={disabled} spellcheck="false" />
		</div>
		<div>
			<Label for={`${eventId}-project-id`}>{$_('trustedPublishing.projectId')}</Label>
			<Input id={`${eventId}-project-id`} bind:value={circleProjectId} disabled={disabled} spellcheck="false" />
		</div>
		<div>
			<Label for={`${eventId}-pipeline`}>{$_('trustedPublishing.pipelineDefinitionId')}</Label>
			<Input id={`${eventId}-pipeline`} bind:value={pipelineDefinitionId} disabled={disabled} spellcheck="false" />
		</div>
		<div>
			<Label for={`${eventId}-vcs`}>{$_('trustedPublishing.vcsOrigin')}</Label>
			<Input id={`${eventId}-vcs`} bind:value={vcsOrigin} placeholder="github.com/owner/repo" disabled={disabled} spellcheck="false" />
		</div>
		<div>
			<Label for={`${eventId}-contexts`}>{$_('trustedPublishing.contextIds')}</Label>
			<Input id={`${eventId}-contexts`} bind:value={contextIds} placeholder={$_('trustedPublishing.contextIdsPlaceholder')} disabled={disabled} spellcheck="false" />
		</div>
	{/if}

	{#if provider === 'github' || provider === 'gitlab'}
		<div>
			<Label for={`${eventId}-environment`}>{$_('trustedPublishing.environment')}</Label>
			<Input id={`${eventId}-environment`} bind:value={environment} placeholder="release" disabled={disabled} spellcheck="false" />
		</div>
	{/if}

	<div class="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
		<label class="flex items-center justify-between gap-3" for={`${eventId}-allow-publish`}>
			<span>{$_('trustedPublishing.allowPublish')}</span>
			<Switch id={`${eventId}-allow-publish`} bind:checked={allowPublish} disabled={disabled} />
		</label>
		<label class="flex items-center justify-between gap-3" for={`${eventId}-allow-stage`}>
			<span>{$_('trustedPublishing.allowStagePublish')}</span>
			<Switch id={`${eventId}-allow-stage`} bind:checked={allowStagePublish} disabled={disabled} />
		</label>
		{#if !valid}
			<p class="text-[11px] text-destructive">{$_('trustedPublishing.formIncomplete')}</p>
		{/if}
	</div>
</div>
