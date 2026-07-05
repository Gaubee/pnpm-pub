<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
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
		TRUSTED_PUBLISHING_FIELDS,
		type TrustedPublishingFieldKey,
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

	// Field metadata lives in $lib/trusted-publishing.ts so the read-only view
	// (TrustedPublishingReadonly) and this form stay in sync.
	const PROVIDER_FIELDS = TRUSTED_PUBLISHING_FIELDS;

	let provider = $state<TrustedPublisherType>('github');
	// A single reactive object so `bind:value={values[field.key]}` works in the
	// generic grid renderer (Svelte 5 deep reactivity).
	let values = $state<Record<TrustedPublishingFieldKey, string>>({
		repoOwner: '',
		repoName: '',
		workflowFile: '',
		ciFilePath: '',
		environment: '',
		orgId: '',
		circleProjectId: '',
		pipelineDefinitionId: '',
		contextIds: '',
		vcsOrigin: '',
	});
	let allowPublish = $state(true);
	let allowStagePublish = $state(true);
	let initializedKey = '';
	let sentKey = '';

	const providerFields = $derived(PROVIDER_FIELDS[provider]);

	function reset(): void {
		values = {
			repoOwner: '',
			repoName: '',
			workflowFile: '',
			ciFilePath: '',
			environment: '',
			orgId: '',
			circleProjectId: '',
			pipelineDefinitionId: '',
			contextIds: '',
			vcsOrigin: '',
		};
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
			values.repoOwner = owner ?? '';
			values.repoName = rest.join('/');
			values.workflowFile = source.claims.workflow_ref.file;
			values.environment = source.claims.environment ?? '';
		} else if (source.type === 'gitlab') {
			const [owner, ...rest] = source.claims.project_path.split('/');
			values.repoOwner = owner ?? '';
			values.repoName = rest.join('/');
			values.ciFilePath = source.claims.ci_config_ref_uri ?? '';
			values.environment = source.claims.environment ?? '';
		} else {
			values.orgId = source.claims['oidc.circleci.com/org-id'];
			values.circleProjectId = source.claims['oidc.circleci.com/project-id'];
			values.pipelineDefinitionId = source.claims['oidc.circleci.com/pipeline-definition-id'];
			values.contextIds = (source.claims['oidc.circleci.com/context-ids'] ?? []).join(', ');
			values.vcsOrigin = source.claims['oidc.circleci.com/vcs-origin'];
		}
	}

	function prefillFromHint(): void {
		reset();
		provider = providerFromHint(repositoryHint);
		const repo = splitRepositoryHint(repositoryHint);
		values.repoOwner = repo.owner;
		values.repoName = repo.name;
		if (provider === 'gitlab') values.ciFilePath = '.gitlab-ci.yml';
	}

	// Re-init (which resets the fields) ONLY when the form's IDENTITY changes —
	// NOT every time the seeded `config` content changes. Including config in
	// the key re-introduced an echo→reset loop: a custom member's edit sends an
	// `updateConfigureTrustDraft`, the daemon echoes the updated member event,
	// `config` changes, the init effect re-runs `reset()`, and the user's
	// in-flight edit is wiped (and re-sent → echo → loop). The form seeds from
	// `config`/`currentConfig` ONCE per identity; after that the user owns the
	// fields. Identity = `groupId` for the group path (stable across re-sorts),
	// else `eventId`.
	$effect(() => {
		const identity = groupId ?? eventId;
		const key = `${identity}:${repositoryHint}`;
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
		const env = values.environment.trim() || undefined;
		if (provider === 'github') {
			if (!values.repoOwner.trim() || !values.repoName.trim() || !values.workflowFile.trim()) return null;
			return {
				type: 'github',
				permissions,
				claims: {
					repository: `${values.repoOwner.trim()}/${values.repoName.trim()}`,
					workflow_ref: { file: values.workflowFile.trim() },
					...(env ? { environment: env } : {}),
				},
			};
		}
		if (provider === 'gitlab') {
			if (!values.repoOwner.trim() || !values.repoName.trim()) return null;
			return {
				type: 'gitlab',
				permissions,
				claims: {
					project_path: `${values.repoOwner.trim()}/${values.repoName.trim()}`,
					...(values.ciFilePath.trim() ? { ci_config_ref_uri: values.ciFilePath.trim() } : {}),
					...(env ? { environment: env } : {}),
				},
			};
		}
		if (!values.orgId.trim() || !values.circleProjectId.trim() || !values.pipelineDefinitionId.trim() || !values.vcsOrigin.trim()) {
			return null;
		}
		const contexts = values.contextIds
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean);
		return {
			type: 'circleci',
			permissions,
			claims: {
				'oidc.circleci.com/org-id': values.orgId.trim(),
				'oidc.circleci.com/project-id': values.circleProjectId.trim(),
				'oidc.circleci.com/pipeline-definition-id': values.pipelineDefinitionId.trim(),
				...(contexts.length ? { 'oidc.circleci.com/context-ids': contexts } : {}),
				'oidc.circleci.com/vcs-origin': values.vcsOrigin.trim(),
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

<div class="@container flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
	<ButtonGroup>
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
	</ButtonGroup>

	<!--
		Field grid — container-query responsive (NOT viewport). The form lives
		inside variable-width hosts (EventCard body, GroupEventCard, dialog),
		so it must react to its OWN width:
		  - < 28rem: 1 column   (narrow phone / tight dialog)
		  - ≥ 28rem: 2 columns  (default card width)
		  - ≥ 44rem: 4 columns  (wide dialog / full page; rarely reached)
	-->
	<div class="grid grid-cols-1 gap-3 @[28rem]:grid-cols-2 @[44rem]:grid-cols-4">
		{#each providerFields as field (field.id)}
			{@const placeholder = field.placeholderKey ? $_(field.placeholderKey) : (field.placeholder ?? '')}
			<div class="flex flex-col gap-1">
				{#if mode === 'compact'}
					<!-- Compact: floating-label input (no separate label/help line). -->
					<LabelInput
						id={`${eventId}-${field.id}`}
						label={$_(field.labelKey)}
						bind:value={values[field.key]}
						{placeholder}
						{disabled}
						spellcheck="false"
					/>
				{:else}
					<!-- Full: explicit label + input + optional help description. -->
					<Label for={`${eventId}-${field.id}`}>{$_(field.labelKey)}</Label>
					<Input
						id={`${eventId}-${field.id}`}
						bind:value={values[field.key]}
						{placeholder}
						{disabled}
						spellcheck="false"
					/>
					{#if field.helpKey}
						<p class="text-[10px] leading-snug text-muted-foreground/70">{$_(field.helpKey)}</p>
					{/if}
				{/if}
			</div>
		{/each}
	</div>

	<div class="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
		<label class="flex items-center justify-between gap-3" for={`${eventId}-allow-publish`}>
			<span>{$_('trustedPublishing.allowPublish')}</span>
			<Switch id={`${eventId}-allow-publish`} bind:checked={allowPublish} disabled={disabled} />
		</label>
		{#if mode === 'full'}
			<p class="text-[10px] leading-snug text-muted-foreground/70">{$_('trustedPublishing.allowPublishHelp')}</p>
		{/if}
		<label class="flex items-center justify-between gap-3" for={`${eventId}-allow-stage`}>
			<span>{$_('trustedPublishing.allowStagePublish')}</span>
			<Switch id={`${eventId}-allow-stage`} bind:checked={allowStagePublish} disabled={disabled} />
		</label>
		{#if mode === 'full'}
			<p class="text-[10px] leading-snug text-muted-foreground/70">{$_('trustedPublishing.allowStagePublishHelp')}</p>
		{/if}
	</div>
</div>
