<!-- Browser-regression host for per-config removal review and group-root actions. -->
<script lang="ts">
	import EventCardFooter from '$lib/components/event-card-footer.svelte';
	import GroupEventCard from '$lib/components/group-event-card.svelte';
	import TrustedPublishingRemovalReview from '$lib/components/trusted-publishing-removal-review.svelte';
	import { materializeEventGroup } from '$lib/group-event.js';
	import { deriveRemovalReviewState } from '$lib/trusted-publishing.js';
	import type {
		ConfigureTrustContext,
		PubEvent,
		RemovalDecision,
		RemovalDecisions,
		TrustedPublisherRegistryConfig,
	} from '$lib/types.js';

	const configs: TrustedPublisherRegistryConfig[] = [
		{
			id: 'github-id',
			type: 'github',
			permissions: ['createPackage'],
			claims: { repository: 'owner/repo', workflow_ref: { file: 'publish.yml' } },
		},
		{
			id: 'gitlab-id',
			type: 'gitlab',
			permissions: ['createPackage'],
			claims: { project_path: 'owner/repo' },
		},
	];
	const removalContext: ConfigureTrustContext = {
		action: 'remove',
		target: { name: '@scope/standalone' },
	};

	let decisions = $state<RemovalDecisions>({
		'github-id': 'remove',
		'gitlab-id': 'remove',
	});
	const review = $derived(deriveRemovalReviewState(configs, decisions));
	function setDecision(configId: string, decision: RemovalDecision): void {
		decisions = { ...decisions, [configId]: decision };
	}

	function groupMember(id: string, name: string): PubEvent {
		return {
			id,
			kind: 'configure-trust',
			status: 'pending',
			profile: 'alice',
			createdAt: Number(id),
			groupId: 'removal-group',
			removalSnapshot: configs,
			removalDecisions: {
				'github-id': 'remove',
				'gitlab-id': 'remove',
			},
			payload: {
				kind: 'configure-trust',
				data: {
					action: 'remove',
					target: { name, path: `/workspace-root/packages/${id}` },
					root: '/workspace-root',
				},
			},
		};
	}

	const group = materializeEventGroup({
		id: 'removal-group',
		events: [groupMember('2', '@scope/b'), groupMember('1', '@scope/a')],
	});

</script>

<div class="mx-auto flex max-w-2xl flex-col gap-5 p-6">
	<section data-testid="removal-review">
		<TrustedPublishingRemovalReview
			{configs}
			{decisions}
			status="ready"
			onDecision={setDecision}
		/>
	</section>

	<section data-testid="removal-footer">
		<EventCardFooter
			eventKind="configure-trust"
			status="pending"
			isPending
			isExpired={false}
			needsAction={false}
			isRetryableStatus={false}
			isRetryable={false}
			hasRetryButton={false}
			isUnpublishable={false}
			isPublish={false}
			configureTrustCtx={removalContext}
			unpublishCtx={null}
			publishData={null}
			canConfirm={review.reviewed && review.hasRemove}
			confirming={false}
			rejecting={false}
			autoClose={false}
			variant="full"
			repoInfo={null}
			sourcePath=""
			npmUrl=""
			onOpenUrl={() => {}}
			onOpenPath={() => {}}
			onConfirm={() => {}}
			onReject={() => {}}
			onRetry={() => {}}
			onUnpublish={() => {}}
		/>
	</section>

	<section data-testid="removal-group">
		<GroupEventCard {group} surface="pending" />
	</section>
</div>
