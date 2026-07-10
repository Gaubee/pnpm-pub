<script lang="ts">
	/**
	 * TOTP 扫码层（全屏覆盖窗口，非 Dialog 卡片）。
	 *
	 * 两种模式：
	 *   - `live`   ：摄像头实时流 cover 铺满整窗 + 扫描线 + 底部 3 按钮
	 *               （相册 / 拍摄 / 翻转）。实时识别到二维码即切到 preview。
	 *   - `preview`：把命中帧/选中图片画进 <canvas>，底部换成 取消(X) / 确认(✓)。
	 *               ✓ 仅在识别到合法 TOTP 内容时 enable；命中标签显示在按钮上方。
	 *
	 * 全屏层会盖住 titlebar 区域，但 OS 控件（overlay-window-controls）必须保持可点
	 * 且不可被遮——所以关闭按钮放在 titlebar 行之下、并避让右侧 controlInset。
	 *
	 * 职责边界：扫码**只验证合法**并回填**原始二维码原文**（otpauth://… 等）；
	 * 解析（提取 secret + 用户名自动填充）是输入框既有逻辑的事，不在本组件做。
	 * 关闭/销毁必停流释放硬件。
	 */
	import { onDestroy } from 'svelte';
	import { QR_DECODER_CONFIG, createQrScannerConfig, type CameraFacingMode } from '$lib/qr-scanner-policy.js';
	import { parseTotpSecret } from '$lib/totp.js';
	import type { Html5Qrcode } from 'html5-qrcode';
	import type { OpentrayRect, OpentrayWindowOverlay } from '../../opentray.d.ts';
	import IconX from '@lucide/svelte/icons/x';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconImage from '@lucide/svelte/icons/image';
	import IconCamera from '@lucide/svelte/icons/camera';
	import IconSwitch from '@lucide/svelte/icons/switch-camera';

	let {
		open = $bindable(false),
		onResult,
	}: {
		open?: boolean;
		/** 命中确认回调，传**原始二维码原文**（otpauth://… 等），不做解析。
		 *  解析（提取 secret + 用户名自动填充）是输入框既有逻辑的职责。 */
		onResult?: (raw: string) => void;
	} = $props();

	type Mode = 'live' | 'preview';
	let mode = $state<Mode>('live');

	let scannerHostEl = $state<HTMLDivElement | null>(null);
	let previewVideoEl = $state<HTMLVideoElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	// --- 摄像头 / 识别运行时 ---
	const scannerHostId = 'totp-scan-video';
	let facingMode: CameraFacingMode = 'environment';
	let html5: Html5Qrcode | null = null;
	let busy = $state(false);
	let cameraDenied = $state(false);

	// --- 预览态：命中结果 ---
	// 扫码只**验证合法**并保留**原始二维码原文**；不在这里提取 secret（那是输入框的事）。
	let pendingRaw = $state<string | null>(null); // 原文，null=未识别到合法 TOTP 内容
	let pendingLabel = $state<string | undefined>(undefined); // 解析出的标签（仅预览提示用，不回填）

	// OS 控件右侧占位宽度（与 WindowDragRegion 同源读法），关闭按钮据此避让。
	let controlInset = $state(70);

	const ot = (): Navigator['opentrayWindow'] | NonNullable<Navigator['opentray']>['window'] | undefined =>
		navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;

	/** 读 overlay 几何，算出右侧 OS 控件簇宽度。 */
	function syncControlInset(): void {
		const overlay: OpentrayWindowOverlay | undefined = ot()?.overlay;
		if (!overlay) return;
		void overlay
			.getTitlebarAreaRect()
			.then((rect: OpentrayRect) => {
				controlInset = Math.max(0, Math.round(globalThis.innerWidth - rect.x - rect.width));
			})
			.catch(() => {});
	}

	// --- 摄像头生命周期 ---
	async function startCamera(): Promise<void> {
		await stopCamera();
		cameraDenied = false;
		pendingRaw = null;
		try {
			await startHtml5Live();
		} catch {
			await stopCamera();
			cameraDenied = true;
		}
	}

	async function startHtml5Live(): Promise<void> {
		if (!scannerHostEl) return;
		const { Html5Qrcode } = await import('html5-qrcode');
		const scanner = new Html5Qrcode(scannerHostId, QR_DECODER_CONFIG);
		html5 = scanner;
		await scanner.start(
			{ facingMode },
			createQrScannerConfig(facingMode),
			(text: string) => void captureLiveResult(text),
			() => {},
		);
		await connectPreviewToScannerStream();
	}

	/**
	 * The scanner's video is a measurement surface for html5-qrcode. Mirror its
	 * stream into a separate cover projection so presentation never distorts the
	 * frame the decoder maps back to source pixels.
	 */
	async function connectPreviewToScannerStream(): Promise<void> {
		const scannerVideo = scannerHostEl?.querySelector('video') ?? null;
		if (!scannerVideo?.srcObject || !previewVideoEl) return;
		previewVideoEl.srcObject = scannerVideo.srcObject;
		await previewVideoEl.play().catch(() => {});
	}

	async function stopCamera(): Promise<void> {
		const scanner = html5;
		html5 = null;
		if (!scanner) return;
		try {
			await scanner.stop();
		} catch {
			// A start failure may leave no active track to stop.
		}
		try {
			scanner.clear();
		} catch {
			// The scanner can already have cleared its host after a failed start.
		}
		if (previewVideoEl) previewVideoEl.srcObject = null;
	}

	/**
	 * 把当前解码器的完整视频帧画进 canvas 并切到 preview 态。
	 * 视觉上的扫描框只是定位提示，不参与裁剪。
	 */
	function captureToPreview(): boolean {
		const videoEl = scannerHostEl?.querySelector('video') ?? null;
		if (!videoEl || videoEl.readyState < 2 || !canvasEl) return false;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return false;
		canvasEl.width = videoEl.videoWidth;
		canvasEl.height = videoEl.videoHeight;
		ctx.drawImage(videoEl, 0, 0);
		mode = 'preview';
		return true;
	}

	/** 走与实时扫描相同的 QR-only ZXing 解码器解析静态图。 */
	async function decodeImageFile(file: File): Promise<void> {
		const { Html5Qrcode } = await import('html5-qrcode');
		const inst = new Html5Qrcode('totp-scan-file-tmp', QR_DECODER_CONFIG);
		try {
			const result = await inst.scanFileV2(file, false);
			applyDecoded(result.decodedText);
		} catch {
			pendingRaw = null;
		} finally {
			inst.clear();
		}
	}

	async function captureLiveResult(decoded: string): Promise<void> {
		if (busy || mode !== 'live') return;
		busy = true;
		try {
			if (captureToPreview()) applyDecoded(decoded);
			await stopCamera();
		} finally {
			busy = false;
		}
	}

	/** 验证二维码原文是否为合法 TOTP 内容。合法则保留**原文** + 取标签做提示；
	 *  不在这里提取 secret（回填原文后由输入框的解析逻辑处理）。 */
	function applyDecoded(raw: string): void {
		const parsed = parseTotpSecret(raw);
		pendingRaw = parsed ? raw : null; // 保留原文，合法才非 null
		pendingLabel = parsed?.label;
	}

	// --- 底部操作（live 态 3 按钮） ---
	async function onCapture(): Promise<void> {
		if (busy || !captureToPreview() || !canvasEl) return;
		busy = true;
		try {
			await stopCamera();
			const blob = await new Promise<Blob>((resolve, reject) => {
				canvasEl?.toBlob((value) => (value ? resolve(value) : reject(new Error('frame encode failed'))), 'image/png');
			});
			await decodeImageFile(new File([blob], 'frame.png', { type: 'image/png' }));
		} finally {
			busy = false;
		}
	}

	async function onPickImage(e: Event): Promise<void> {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !canvasEl) return;
		busy = true;
		try {
			// 把图片画进 canvas 进 preview 态，再静态识别。
			const img = await loadImage(file);
			canvasEl.width = img.naturalWidth;
			canvasEl.height = img.naturalHeight;
			canvasEl.getContext('2d')?.drawImage(img, 0, 0);
			mode = 'preview';
			await stopCamera();
			await decodeImageFile(file);
		} catch {
			pendingRaw = null; // 图片无二维码：保留预览，✓ disabled
		} finally {
			busy = false;
		}
	}

	function loadImage(file: File): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const url = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => {
				URL.revokeObjectURL(url);
				resolve(img);
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error('img load failed'));
			};
			img.src = url;
		});
	}

	function flipCamera(): void {
		facingMode = facingMode === 'environment' ? 'user' : 'environment';
		void startCamera();
	}

	// --- 底部操作（preview 态 2 按钮） ---
	function cancelPreview(): void {
		// 回到实时扫描。
		mode = 'live';
		pendingRaw = null;
		pendingLabel = undefined;
		void startCamera();
	}

	function confirmPreview(): void {
		if (!pendingRaw) return;
		onResult?.(pendingRaw); // 回填**原始二维码原文**，解析交给输入框
		open = false;
	}

	// --- 弹层开关 + 销毁 ---
	$effect(() => {
		if (!open) return;
		mode = 'live';
		pendingRaw = null;
		pendingLabel = undefined;
		syncControlInset();
		void startCamera();
	});
	$effect(() => {
		if (!open) stopCamera();
	});
	onDestroy(() => void stopCamera());

	const previewHit = $derived(pendingRaw !== null);
</script>

{#if open}
	<!--
		全屏覆盖层：fixed inset-0 铺满整窗。video/canvas 用 object-cover 填满。
		OS 控件簇在右上角（controlInset 宽），本层不画在控件区域内——关闭按钮的
		right 避让 controlInset，且 top 落在 titlebar(2rem) 之下。
	-->
	<div
		class="scanner fixed inset-0 z-50 grid grid-cols-1 grid-rows-1 bg-black"
		role="dialog"
		aria-modal="true"
		aria-label="扫描 TOTP 二维码"
		tabindex="-1"
	>
		<!-- html5-qrcode 独占摄像头生命周期；其 video 子节点填满预览。 -->
		<div bind:this={scannerHostEl} id={scannerHostId} class="scanner-decoder" aria-hidden="true"></div>
		<!-- 视觉投影与解码器的测量 video 分离，cover 不改变解码几何。 -->
		<video
			bind:this={previewVideoEl}
			class="absolute inset-0 h-full w-full object-cover"
			playsinline
			muted
		></video>
		<!-- 命中/选中帧（preview 态） -->
		<canvas
			bind:this={canvasEl}
			class="col-start-1 row-start-1 h-full min-h-0 w-full min-w-0 object-cover {mode === 'preview' ? '' : 'hidden'}"
		></canvas>

		{#if mode === 'live'}
			<!-- 扫描框镂空遮罩 + 扫描线 -->
			<div class="pointer-events-none absolute inset-0">
				<div class="absolute left-0 top-0 h-[15%] w-full bg-black/55"></div>
				<div class="absolute bottom-0 left-0 h-[15%] w-full bg-black/55"></div>
				<div class="absolute left-0 top-[15%] h-[70%] w-[15%] bg-black/55"></div>
				<div class="absolute right-0 top-[15%] h-[70%] w-[15%] bg-black/55"></div>
				<div class="scan-frame absolute left-1/2 top-1/2 h-[60%] w-[72%] max-w-[280px] -translate-x-1/2 -translate-y-1/2">
					<span class="scan-line"></span>
				</div>
			</div>
			{#if cameraDenied}
				<div class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
					<p class="text-xs text-white/80">未获得摄像头权限，请使用图片识别</p>
				</div>
			{/if}
		{/if}

		<!-- 顶部线性渐变遮罩：保证关闭按钮/OS 控件在亮画面下可辨 -->
		<div class="scanner-topfade pointer-events-none absolute inset-x-0 top-0"></div>

		<!-- 关闭按钮：避让 OS 控件（right=controlInset+8），落在 titlebar 之下（top=2rem+4） -->
		<button
			type="button"
			class="scanner-close"
			style="right: {controlInset + 8}px; top: calc(2rem + 4px)"
			onclick={() => (open = false)}
			aria-label="关闭"
		>
			<IconX class="h-5 w-5" />
		</button>

		<!-- 命中内容提示（preview 态，在按钮簇上方） -->
		{#if mode === 'preview' && pendingLabel}
			<div class="absolute inset-x-0 bottom-28 flex justify-center px-4">
				<span class="max-w-full truncate rounded-full bg-black/60 px-3 py-1 text-xs text-white/90">
					{pendingLabel}
				</span>
			</div>
		{/if}

		<!-- 底部控制栏：渐变遮罩保证按钮在任意画面下可读 -->
		<div class="scanner-bar absolute inset-x-0 bottom-0 flex items-center justify-around px-4 pb-5 pt-8">
			<input bind:this={fileInputEl} type="file" accept="image/*" class="hidden" onchange={onPickImage} />
			{#if mode === 'live'}
				<button
					type="button"
					class="action-btn"
					title="相册"
					disabled={busy}
					onclick={() => fileInputEl?.click()}
					aria-label="相册"
				>
					<IconImage class="h-6 w-6" />
				</button>
				<button
					type="button"
					class="action-btn action-btn--primary"
					title="拍摄"
					disabled={busy || cameraDenied}
					onclick={onCapture}
					aria-label="拍摄"
				>
					<IconCamera class="h-7 w-7" />
				</button>
				<button
					type="button"
					class="action-btn"
					title="翻转摄像头"
					disabled={busy || cameraDenied}
					onclick={flipCamera}
					aria-label="翻转摄像头"
				>
					<IconSwitch class="h-6 w-6" />
				</button>
			{:else}
				<!-- preview 态：取消(X) / 确认(✓) -->
				<button
					type="button"
					class="action-btn action-btn--cancel"
					title="取消"
					onclick={cancelPreview}
					aria-label="取消"
				>
					<IconX class="h-6 w-6" />
				</button>
				<button
					type="button"
					class="action-btn action-btn--confirm"
					title={previewHit ? '确认' : '未识别到二维码'}
					disabled={!previewHit || busy}
					onclick={confirmPreview}
					aria-label={previewHit ? '确认' : '未识别到二维码'}
				>
					<IconCheck class="h-6 w-6" />
				</button>
			{/if}
		</div>

		<!-- html5-qrcode scanFile 挂载点（不可见） -->
		<div id="totp-scan-file-tmp" class="hidden"></div>
	</div>
{/if}

<style>
	/* 顶部线性渐变遮罩：从黑到透明，托住关闭按钮 + OS 控件区可辨。 */
	.scanner-topfade {
		height: 6rem;
		background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0));
		z-index: 1;
	}

	/* html5-qrcode owns this hidden, proportional measurement surface. */
	.scanner-decoder {
		inset: 0;
		pointer-events: none;
		position: absolute;
		visibility: hidden;
	}
	.scanner-decoder :global(canvas) {
		display: none;
	}

	/* 底部控制栏：从透明到黑，托住操作按钮可读。 */
	.scanner-bar {
		background: linear-gradient(to top, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0));
		z-index: 1;
	}

	.scanner-close {
		position: absolute;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2rem;
		width: 2rem;
		border-radius: 9999px;
		background: rgba(0, 0, 0, 0.45);
		color: #fff;
		border: none;
		cursor: pointer;
		z-index: 2;
	}
	.scanner-close:hover {
		background: rgba(0, 0, 0, 0.7);
	}

	/* 大号 + 全圆角操作按钮。 */
	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 3.25rem;
		width: 3.25rem;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
		border: 1px solid rgba(255, 255, 255, 0.25);
		cursor: pointer;
		-webkit-backdrop-filter: blur(8px);
		backdrop-filter: blur(8px);
		transition:
			background-color 0.12s ease,
			transform 0.12s ease,
			opacity 0.12s ease;
	}
	.action-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.38);
	}
	.action-btn:active:not(:disabled) {
		transform: scale(0.94);
	}
	.action-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	/* 拍摄按钮：稍大 + 实心强调。 */
	.action-btn--primary {
		height: 3.75rem;
		width: 3.75rem;
		background: rgba(255, 255, 255, 0.95);
		color: #111;
	}
	.action-btn--primary:hover:not(:disabled) {
		background: #fff;
	}
	/* 取消按钮：红色半透明（保留半透明 border + 玻璃 blur），hover 更亮。 */
	.action-btn--cancel {
		background: rgba(220, 38, 38, 0.5);
		color: #fff;
	}
	.action-btn--cancel:hover:not(:disabled) {
		background: rgba(220, 38, 38, 0.7);
	}
	/* 确认按钮：命中时 success 色（保留半透明白边）。 */
	.action-btn--confirm:enabled {
		background: var(--success, #16a34a);
		color: #fff;
	}
	.action-btn--confirm:disabled {
		color: rgba(255, 255, 255, 0.6);
	}

	/* 扫描框 + 上下循环扫描线 */
	.scan-frame {
		border: 2px solid rgba(255, 255, 255, 0.9);
		border-radius: 0.75rem;
	}
	.scan-line {
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent, var(--brand, #006bff) 50%, transparent);
		box-shadow: 0 0 8px 1px var(--brand, #006bff);
		animation: scan-move 2s ease-in-out infinite;
	}
	@keyframes scan-move {
		0% {
			top: 0;
		}
		50% {
			top: calc(100% - 2px);
		}
		100% {
			top: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.scan-line {
			animation: none;
			top: 50%;
		}
	}
</style>
