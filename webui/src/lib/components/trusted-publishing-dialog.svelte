<script lang="ts">
    import { goto } from "$app/navigation";
    import {
        Dialog,
        DialogContent,
        DialogDescription,
        DialogFooter,
        DialogHeader,
        DialogTitle,
    } from "$lib/components/ui/dialog/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ButtonGroup } from "$lib/components/ui/button-group/index.js";
    import { actions, getRpcClient, pushToast } from "$lib/store.js";
    import TrustedPublishingReadonly from "$lib/components/trusted-publishing-readonly.svelte";
    import BrandIcon from "$lib/components/brand-icon.svelte";
    import type {
        TrustedPublisherConfig,
        TrustedPublishingTarget,
    } from "$lib/types.js";
    import { providerLabelKey, providerBrandId } from "$lib/trusted-publishing.js";
    import { _ } from "svelte-i18n";
    import IconShield from "@lucide/svelte/icons/shield-check";
    import IconShieldCog from "@lucide/svelte/icons/shield-cog-corner";
    import IconShieldMinus from "@lucide/svelte/icons/shield-minus";
    import IconCopy from "@lucide/svelte/icons/copy";
    import IconFileCode from "@lucide/svelte/icons/file-code-2";
    import IconSave from "@lucide/svelte/icons/save";

    let {
        open = $bindable(false),
        packageName = "",
        packagePath = "",
        packageNames = undefined,
        packageTargets = undefined,
        config = undefined,
        configs = undefined,
        configLoading = false,
        onChanged = () => {},
        repositoryHint = "",
        initialTab = "current",
    }: {
        open?: boolean;
        packageName?: string;
        packagePath?: string;
        packageNames?: string[];
        packageTargets?: TrustedPublishingTarget[];
        config?: TrustedPublisherConfig | null;
        /** The FULL array of current registry configs (may contain more than
         *  one). When provided, the content renders one card per config so each
         *  provider config (GitHub/CircleCI/GitLab) is distinguishable. Falls
         *  back to the singular `config` prop for backward compatibility. */
        configs?: TrustedPublisherConfig[] | null;
        /** True while the caller is still resolving `config` from the registry.
         *  Prevents the single-package "no current config" branch from firing
         *  before the lookup completes (otherwise a slow registry would turn an
         *  update/remove into a stray add event). */
        configLoading?: boolean;
        onChanged?: () => void;
        repositoryHint?: string;
        initialTab?: "current" | "workflow";
    } = $props();

    const isBatch = $derived(
        (packageTargets?.length ?? packageNames?.length ?? 0) > 0,
    );
    /** The current registry configs as an array. Prefers the explicit `configs`
     *  prop (full array); falls back to the singular `config` for backward
     *  compatibility. Empty when nothing is configured yet. */
    const effectiveConfigs = $derived(
        configs && configs.length > 0
            ? configs
            : config
              ? [config]
              : [],
    );
    const hasCurrentConfig = $derived(effectiveConfigs.length > 0);
    const canPreviewWorkflow = $derived(hasCurrentConfig && !!packagePath.trim());
    const singleTarget = $derived.by((): TrustedPublishingTarget => ({
        name: packageName.trim(),
        ...(packagePath.trim() ? { path: packagePath.trim() } : {}),
        ...(repositoryHint.trim() ? { repository: repositoryHint.trim() } : {}),
        ...(effectiveConfigs[0] ? { currentConfig: effectiveConfigs[0] } : {}),
    }));
    const batchTargets = $derived.by((): TrustedPublishingTarget[] => {
        if (packageTargets && packageTargets.length > 0) return packageTargets;
        return (packageNames ?? [])
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => ({ name }));
    });

    let selected = $state<string[]>([]);
    /** Tracks the last `open` value so we only re-seed local UI state on a
     *  false→true transition, not on every dependent re-render. */
    let wasOpen = false;
    let activeTab = $state<"current" | "workflow">("current");
    let workflowLoading = $state(false);
    let workflowContent = $state("");
    let workflowPath = $state("");
    let workflowExists = $state(false);
    let workflowError = $state("");
    let writingWorkflow = $state(false);
    let confirmWorkflowOverwrite = $state(false);

    $effect(() => {
        // Only react to the open transition itself; reading other dependents
        // (batchTargets / canPreviewWorkflow) here would re-run on every keystroke
        // and re-seed the selection, wiping the user's toggles.
        if (!open) {
            wasOpen = false;
            return;
        }
        if (wasOpen) return;
        wasOpen = true;
        selected = batchTargets.map((target) => target.name);
        activeTab =
            canPreviewWorkflow && initialTab === "workflow"
                ? "workflow"
                : "current";
        confirmWorkflowOverwrite = false;
    });

    // Single-package "no current config" → create an add event. This used to
    // live inside the open effect, which (a) mutated state during render and
    // (b) raced the caller's `config` lookup — a slow registry made every
    // update/remove land as an add. Now it only fires once `configLoading`
    // settles, and only after a tick so it never runs during render.
    $effect(() => {
        if (!open) return;
        if (isBatch || hasCurrentConfig || configLoading) return;
        if (!singleTarget.name) return;
        const target = singleTarget;
        // Defer the side effect out of the reactive update phase.
        queueMicrotask(() => {
            if (!open || hasCurrentConfig || configLoading) return;
            actions.createEvent("configure-trust", { action: "add", target });
            finish();
        });
    });

    function selectedTargets(): TrustedPublishingTarget[] {
        return batchTargets.filter((target) => selected.includes(target.name));
    }

    function toggle(name: string): void {
        selected = selected.includes(name)
            ? selected.filter((item) => item !== name)
            : [...selected, name];
    }

    function finish(): void {
        onChanged();
        open = false;
        void goto("/active-events");
    }

    function createSingle(action: "add" | "update" | "remove"): void {
        if (!singleTarget.name) return;
        actions.createEvent("configure-trust", {
            action,
            target: singleTarget,
        });
        finish();
    }

    function createBatch(): void {
        const targets = selectedTargets();
        if (targets.length === 0) return;
        const groupId = crypto.randomUUID();
        const root = packagePath.trim() || undefined;
        for (const target of targets) {
            actions.createEvent(
                "configure-trust",
                {
                    action: target.currentConfig ? "update" : "add",
                    target,
                    ...(root ? { root } : {}),
                },
                groupId,
            );
        }
        finish();
    }

    /** Batch REMOVE: create a `configure-trust/remove` event for every selected
     *  package, sharing one groupId so they form a single Remove Trusted
     *  Publishing group in the Events Hub. */
    function createBatchRemove(): void {
        const targets = selectedTargets();
        if (targets.length === 0) return;
        const groupId = crypto.randomUUID();
        const root = packagePath.trim() || undefined;
        for (const target of targets) {
            actions.createEvent(
                "configure-trust",
                { action: "remove", target, ...(root ? { root } : {}) },
                groupId,
            );
        }
        finish();
    }

    $effect(() => {
        if (!open || !canPreviewWorkflow || activeTab !== "workflow") return;
        void loadWorkflowPreview();
    });

    async function loadWorkflowPreview(): Promise<void> {
        const firstConfig = effectiveConfigs[0];
        if (!firstConfig || !packagePath.trim()) {
            workflowContent = "";
            workflowPath = "";
            workflowExists = false;
            workflowError = $_("trustedPublishing.workflowPathRequired");
            return;
        }
        const client = getRpcClient();
        if (!client) return;
        workflowLoading = true;
        workflowError = "";
        confirmWorkflowOverwrite = false;
        try {
            const result = await client.setupOidc.previewWorkflow({
                packagePath: packagePath.trim(),
                config: firstConfig,
            });
            if (result.ok && result.content && result.path) {
                workflowContent = result.content;
                workflowPath = result.path;
                workflowExists = !!result.exists;
            } else {
                workflowContent = "";
                workflowPath = "";
                workflowExists = false;
                workflowError =
                    result.error ??
                    $_("trustedPublishing.workflowPreviewFailed");
            }
        } finally {
            workflowLoading = false;
        }
    }

    async function copyWorkflow(): Promise<void> {
        if (!workflowContent) return;
        await navigator.clipboard.writeText(workflowContent);
        pushToast("success", $_("trustedPublishing.workflowCopied"));
    }

    async function writeWorkflow(force = false): Promise<void> {
        const firstConfig = effectiveConfigs[0];
        if (!firstConfig || !packagePath.trim()) return;
        const client = getRpcClient();
        if (!client) return;
        writingWorkflow = true;
        try {
            const result = await client.setupOidc.writeWorkflow({
                packagePath: packagePath.trim(),
                config: firstConfig,
                force,
            });
            if (result.ok && result.content && result.path) {
                workflowContent = result.content;
                workflowPath = result.path;
                workflowExists = !!result.exists;
                workflowError = "";
                confirmWorkflowOverwrite = false;
                pushToast("success", $_("trustedPublishing.workflowWritten"));
            } else {
                workflowError =
                    result.error ?? $_("trustedPublishing.workflowWriteFailed");
                pushToast("error", workflowError);
            }
        } finally {
            writingWorkflow = false;
        }
    }
</script>

<Dialog bind:open>
    <DialogContent
        class="w-130 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
    >
        <!-- HEADER — fixed, never scrolls or compresses -->
        <DialogHeader class="border-b px-4 py-3">
            <DialogTitle class="flex items-center gap-2 text-base">
                <span
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-brand/38 bg-brand/10 text-brand"
                >
                    <IconShieldCog class="h-3.5 w-3.5" />
                </span>
                {$_(isBatch
                    ? "trustedPublishing.recursiveTitle"
                    : "trustedPublishing.oidcTitle")}
            </DialogTitle>
            <DialogDescription>
                {#if isBatch}
                    {$_("trustedPublishing.batchSubtitle", {
                        values: {
                            path: packagePath || repositoryHint || "—",
                            count: batchTargets.length,
                            selected: selected.length,
                        },
                    })}
                {:else if packagePath}
                    {$_("trustedPublishing.singleSubtitle", {
                        values: { name: packageName, path: packagePath },
                    })}
                {:else}
                    {packageName}
                {/if}
            </DialogDescription>
        </DialogHeader>

        <!-- CONTENT — the only scrollable region. min-h-0 lets the grid 1fr
             row actually shrink so overflow kicks in instead of growing the
             dialog past its max-height. -->
        <div class="min-h-0 overflow-y-auto px-4 py-3">
            {#if !isBatch && hasCurrentConfig}
                <!-- "Current Trusted Publishing Configs" header row. The
                     [Current|Code] tab switcher sits at the inline-end, only
                     when a workflow preview is available (needs a package
                     path). Above the content branch so it stays visible in
                     both views. -->
                <div class="mb-2 flex items-center gap-2 text-xs font-medium">
                    <IconShieldCog class="h-4 w-4 text-brand" />
                    {$_("trustedPublishing.currentConfigs")}
                    {#if canPreviewWorkflow}
                        <div class="ml-auto flex shrink-0 gap-0.5 rounded-md bg-muted/40 p-0.5">
                            <button
                                type="button"
                                class="rounded px-2 py-0.5 text-[11px] font-medium transition-colors {activeTab === 'current' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
                                onclick={() => (activeTab = "current")}
                            >
                                {$_("trustedPublishing.currentConfig")}
                            </button>
                            <button
                                type="button"
                                class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors {activeTab === 'workflow' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
                                onclick={() => (activeTab = "workflow")}
                            >
                                <IconFileCode class="h-3 w-3" />
                                {$_("trustedPublishing.workflowTab")}
                            </button>
                        </div>
                    {/if}
                </div>
            {/if}
            {#if isBatch}
                <div class="flex flex-col gap-2">
                    {#each batchTargets as target (target.name)}
                        <label
                            class="flex items-start gap-3 rounded-md border border-border p-3 text-xs transition-colors hover:bg-accent/40"
                        >
                            <input
                                type="checkbox"
                                class="mt-0.5 size-4 shrink-0 cursor-pointer accent-brand"
                                checked={selected.includes(target.name)}
                                onchange={() => toggle(target.name)}
                            />
                            <span class="min-w-0 flex-1">
                                <span
                                    class="block truncate font-mono text-foreground"
                                    >{target.name}</span
                                >
                                <span class="mt-1 block">
                                    <TrustedPublishingReadonly
                                        config={target.currentConfig}
                                        mode="compact"
                                    />
                                </span>
                            </span>
                        </label>
                    {/each}
                </div>
            {:else if hasCurrentConfig && activeTab === "workflow"}
                {#if workflowLoading}
                    <div
                        class="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
                    >
                        {$_("trustedPublishing.workflowLoading")}
                    </div>
                {:else if workflowError}
                    <div
                        class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
                    >
                        {workflowError}
                    </div>
                {:else}
                    <!-- Overwrite confirmation banner — kept INSIDE the
                         scrollable content so it never displaces the footer. -->
                    {#if workflowExists && confirmWorkflowOverwrite}
                        <div
                            class="mb-2 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                        >
                            <span>{$_("trustedPublishing.overwriteWarning")}</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                class="h-6 shrink-0 px-2 text-[11px]"
                                onclick={() => (confirmWorkflowOverwrite = false)}
                                >{$_("common.cancel")}</Button
                            >
                        </div>
                    {/if}
                    <div
                        class="mb-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground"
                    >
                        <span class="font-mono">{workflowPath}</span>
                        {#if workflowExists}
                            <span class="ml-2 text-warning"
                                >{$_("trustedPublishing.workflowExists")}</span
                            >
                        {/if}
                    </div>
                    <pre
                        class="overflow-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed whitespace-pre-wrap">{workflowContent}</pre>
                {/if}
            {:else if hasCurrentConfig}
                <!-- Current-config block (also reused when no workflow tab).
                     Renders EVERY configured trusted publisher (the registry
                     returns an array) — one card per config so each provider
                     (GitHub Actions / CircleCI / GitLab CI) is distinguishable.
                     The [Current|Code] tab switcher is rendered above this
                     block (shared with the workflow view) when preview is
                     available. -->
                <div class="flex flex-col gap-2">
                    {#each effectiveConfigs as cfg, i (i)}
                        <div class="rounded-md border border-border bg-muted/10 p-2.5">
                            <div class="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                                <BrandIcon id={providerBrandId(cfg.type)} class="h-3 w-3" />
                                {$_(providerLabelKey(cfg.type))}
                            </div>
                            <TrustedPublishingReadonly config={cfg} mode="multiline" />
                        </div>
                    {/each}
                </div>
            {:else if configLoading}
                <div
                    class="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
                >
                    {$_("trustedPublishing.loading")}
                </div>
            {:else}
                <div
                    class="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
                >
                    {$_("trustedPublishing.createEventPending")}
                </div>
            {/if}
        </div>

        <!-- FOOTER — fixed at the bottom. Only rendered when there are real
             actions (batch / current-config / workflow). Transient states
             (loading / pending → auto-creates event) intentionally have no
             footer, so the grid simply drops its last row. -->
        {#if isBatch || hasCurrentConfig}
        <DialogFooter class="mx-0 mb-0 flex-col items-stretch gap-3 rounded-b-xl sm:flex-row sm:items-center">
            {#if isBatch}
                <Button variant="outline" onclick={() => (open = false)}
                    >{$_("common.cancel")}</Button
                >
                <!-- Batch actions as a compact ButtonGroup: Config (add/update)
                     on the left, Remove on the right. -->
                <ButtonGroup>
                    <Button
                        variant="brand"
                        size="sm"
                        disabled={selected.length === 0}
                        onclick={createBatch}
                    >
                        <IconShield class="h-4 w-4" />
                        {$_("trustedPublishing.configAction")}
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        disabled={selected.length === 0}
                        onclick={createBatchRemove}
                    >
                        <IconShieldMinus class="h-4 w-4" />
                        {$_("trustedPublishing.removeTrustedPublishing")}
                    </Button>
                </ButtonGroup>
            {:else if hasCurrentConfig}
                {#if activeTab === "current"}
                    <!-- Single-package actions as a compact ButtonGroup:
                         Config (update) on the left, Remove on the right. -->
                    <ButtonGroup>
                        <Button
                            variant="brand"
                            size="sm"
                            onclick={() => createSingle("update")}
                        >
                            <IconShield class="h-4 w-4" />
                            {$_("trustedPublishing.configAction")}
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            onclick={() => createSingle("remove")}
                        >
                            <IconShieldMinus class="h-4 w-4" />
                            {$_("trustedPublishing.removeTrustedPublishing")}
                        </Button>
                    </ButtonGroup>
                {:else}
                    <Button
                        variant="outline"
                        disabled={!workflowContent}
                        onclick={copyWorkflow}
                    >
                        <IconCopy class="h-4 w-4" />
                        {$_("trustedPublishing.copyWorkflow")}
                    </Button>
                    {#if workflowExists && !confirmWorkflowOverwrite}
                        <Button
                            variant="outline"
                            disabled={!workflowContent || writingWorkflow}
                            onclick={() => (confirmWorkflowOverwrite = true)}
                        >
                            <IconSave class="h-4 w-4" />
                            {$_("trustedPublishing.overwriteWorkflow")}
                        </Button>
                    {:else}
                        <Button
                            variant={workflowExists ? "destructive" : "brand"}
                            disabled={!workflowContent || writingWorkflow}
                            onclick={() => writeWorkflow(workflowExists)}
                        >
                            <IconSave class="h-4 w-4" />
                            {workflowExists
                                ? $_("trustedPublishing.overwriteWorkflow")
                                : $_("trustedPublishing.writeWorkflow")}
                        </Button>
                    {/if}
                {/if}
            {/if}
        </DialogFooter>
        {/if}
    </DialogContent>
</Dialog>
