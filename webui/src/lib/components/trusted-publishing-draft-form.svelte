<script lang="ts">
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
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
		trustedPublisherCreateConfigsEqual,
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
		dirty = $bindable(false),
		stagedConfig = $bindable<TrustedPublisherCreateConfig | null>(null),
		deferSubmit = false,
	}: {
		eventId: string;
		groupId?: string;
		config?: TrustedPublisherCreateConfig;
		currentConfig?: TrustedPublisherConfig;
		repositoryHint?: string;
		mode?: 'full' | 'compact';
		disabled?: boolean;
		valid?: boolean;
		/** Whether the user has changed fields away from the initial seed.
		 *  Bound up the chain so a dialog footer can switch between "Close" and
		 *  "Discard changes + Close". */
		dirty?: boolean;
		/** When `deferSubmit` is true, edits are NOT shipped to the daemon on
		 *  every keystroke; instead the current built config is exposed here so
		 *  the host (a dialog) can stage it locally and submit only on Save.
		 *  Null when the current fields don't build a valid config. */
		stagedConfig?: TrustedPublisherCreateConfig | null;
		deferSubmit?: boolean;
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
	/** Snapshot of the config the form was seeded with (the "clean" state).
	 *  Captured once per identity so `dirty` can compare the live draft against
	 *  it, and `resetToSeed()` can restore both the fields and the daemon
	 *  state. `null` until the first valid build lands (e.g. an empty hint
	 *  seed stays null until required fields are filled — which never happens
	 *  pre-edit, so dirty correctly reads false). */
	let seededConfig = $state<TrustedPublisherCreateConfig | null>(null);

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
		seededKey = '';
		// Reset the seed snapshot: a config/currentConfig seed is known up-front;
		// a hint seed has no config object, so seededConfig is re-captured from
		// the first valid build in the dirty effect below.
		seededConfig = config ?? currentConfig ?? null;
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
		// In deferSubmit mode, expose the built config to the host WITHOUT
		// touching the daemon; the host stages it and submits on Save.
		if (deferSubmit) {
			stagedConfig = builtConfig;
			return;
		}
		if (!builtConfig) return;
		const key = JSON.stringify(builtConfig);
		if (sentKey === key) return;
		sentKey = key;
		if (groupId) actions.updateConfigureTrustGroupDraft(groupId, builtConfig);
		else actions.updateConfigureTrustDraft(eventId, builtConfig);
	});

	// Dirty-state signal (READ-ONLY — never writes to the daemon). Compares the
	// live draft against the seed snapshot. For a hint seed (seededConfig starts
	// null), capture the first valid build as the seed so an untouched hint form
	// reads clean; once the user edits, the comparison diverges → dirty true.
	// The seed capture runs at most once per identity (guarded by seededKey
	// mirroring initializedKey's lifecycle).
	let seededKey = '';
	$effect(() => {
		const draft = builtConfig;
		const identity = groupId ?? eventId;
		if (seededConfig === null && draft && seededKey !== identity) {
			// First valid build after a hint-seed init: adopt it as the clean
			// baseline. (A config/currentConfig seed sets seededConfig directly in
			// the init effect, so this branch only fires for the hint path.)
			seededKey = identity;
			seededConfig = draft;
		}
		dirty = !trustedPublisherCreateConfigsEqual(draft, seededConfig);
	});

	/** Restore the form fields to the seed snapshot. In edit-live mode ALSO
	 *  re-send the seed config to the daemon (earlier edits already shipped) and
	 *  sync `sentKey` so the send-effect doesn't re-POST. In deferSubmit mode the
	 *  daemon was never touched — just restore fields; `stagedConfig` + `dirty`
	 *  re-derive from the reseeded fields. Leaves `initializedKey` untouched.
	 *  No-op if there is no seed to restore to. */
	export function resetToSeed(): void {
		if (!seededConfig) return;
		prefillFromConfig(seededConfig);
		if (deferSubmit) return;
		const key = JSON.stringify(seededConfig);
		sentKey = key;
		if (groupId) actions.updateConfigureTrustGroupDraft(groupId, seededConfig);
		else actions.updateConfigureTrustDraft(eventId, seededConfig);
	}
</script>

<div class="@container flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
	<ToggleGroup.Root
		type="single"
		value={provider}
		onValueChange={(v) => v && (provider = v as TrustedPublisherType)}
		variant="brand"
		size="sm"
	>
		{#each providers as item (item.value)}
			<ToggleGroup.Item value={item.value} disabled={disabled}>
				{$_(item.labelKey)}
			</ToggleGroup.Item>
		{/each}
	</ToggleGroup.Root>

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
