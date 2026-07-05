<!--
 仅供 browser 回归测试（test/browser/trusted-publishing-dialog-event.test.ts）使用的最小宿主路由。
 不依赖 daemon：只挂载 <TrustedPublishingDialog> 并注入预设 config，用于验证
 已有配置时只显示当前配置与 Update/Remove Event 入口。Submit/Remove 路径在测试中不会被触发。
-->
<script lang="ts">
	import TrustedPublishingDialog from '$lib/components/trusted-publishing-dialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { TrustedPublisherConfig } from '$lib/types.js';

	const presetConfig: TrustedPublisherConfig = {
		type: 'github',
		id: 'preset-github-0001',
		permissions: ['createPackage'],
		claims: {
			repository: 'myorg/myrepo',
			workflow_ref: { file: 'publish.yml' },
		},
	};

	let open = $state(true);
</script>

<div class="p-6">
	<h1>Trusted Publishing dialog test host</h1>
	<Button data-testid="open-dialog" onclick={() => (open = true)}>Open Dialog</Button>
	<TrustedPublishingDialog bind:open packageName="test-pkg" config={presetConfig} />
</div>
