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
    import { actions, getRpcClient, pushToast } from "$lib/store.js";
    import { trustedPublisherSummary } from "$lib/trusted-publishing.js";
    import type {
        TrustedPublisherConfig,
        TrustedPublishingTarget,
    } from "$lib/types.js";
    import { _ } from "svelte-i18n";
    import IconShield from "@lucide/svelte/icons/shield-check";
    import IconTrash from "@lucide/svelte/icons/trash-2";
    import IconPencil from "@lucide/svelte/icons/pencil";
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
        onChanged?: () => void;
        repositoryHint?: string;
        initialTab?: "current" | "workflow";
    } = $props();

    const isBatch = $derived(
        (packageTargets?.length ?? packageNames?.length ?? 0) > 0,
    );
    const canPreviewWorkflow = $derived(!!config && !!packagePath.trim());
    const singleTarget = $derived.by((): TrustedPublishingTarget => ({
        name: packageName.trim(),
        ...(packagePath.trim() ? { path: packagePath.trim() } : {}),
        ...(repositoryHint.trim() ? { repository: repositoryHint.trim() } : {}),
        ...(config ? { currentConfig: config } : {}),
    }));
    const batchTargets = $derived.by((): TrustedPublishingTarget[] => {
        if (packageTargets && packageTargets.length > 0) return packageTargets;
        return (packageNames ?? [])
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => ({ name }));
    });

    let selected = $state<string[]>([]);
    let initialized = false;
    let activeTab = $state<"current" | "workflow">("current");
    let workflowLoading = $state(false);
    let workflowContent = $state("");
    let workflowPath = $state("");
    let workflowExists = $state(false);
    let workflowError = $state("");
    let writingWorkflow = $state(false);
    let confirmWorkflowOverwrite = $state(false);

    $effect(() => {
        if (!open) {
            initialized = false;
            return;
        }
        if (initialized) return;
        initialized = true;
        selected = batchTargets.map((target) => target.name);
        activeTab =
            canPreviewWorkflow && initialTab === "workflow"
                ? "workflow"
                : "current";
        confirmWorkflowOverwrite = false;
        if (!isBatch && !config && singleTarget.name) {
            actions.createEvent("configure-trust", {
                action: "add",
                target: singleTarget,
            });
            finish();
        }
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
        for (const target of targets) {
            actions.createEvent(
                "configure-trust",
                {
                    action: target.currentConfig ? "update" : "add",
                    target,
                },
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
        if (!config || !packagePath.trim()) {
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
                config,
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
        if (!config || !packagePath.trim()) return;
        const client = getRpcClient();
        if (!client) return;
        writingWorkflow = true;
        try {
            const result = await client.setupOidc.writeWorkflow({
                packagePath: packagePath.trim(),
                config,
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
    <DialogContent class="w-130" aria-describedby={undefined}>
        <DialogHeader>
            <DialogTitle class="text-base"
                >{$_("trustedPublishing.title")}</DialogTitle
            >
            <DialogDescription>
                {#if isBatch}
                    {$_("trustedPublishing.batchTitle", {
                        values: { n: selected.length },
                    })}
                {:else}
                    {packageName}
                {/if}
            </DialogDescription>
        </DialogHeader>

        {#if isBatch}
            <div class="max-h-[360px] overflow-y-auto pr-1">
                <div class="flex flex-col gap-2">
                    {#each batchTargets as target (target.name)}
                        <label
                            class="flex items-start gap-3 rounded-md border border-border p-3 text-xs"
                        >
                            <input
                                type="checkbox"
                                class="mt-0.5 size-4 accent-current"
                                checked={selected.includes(target.name)}
                                onchange={() => toggle(target.name)}
                            />
                            <span class="min-w-0 flex-1">
                                <span
                                    class="block truncate font-mono text-foreground"
                                    >{target.name}</span
                                >
                                <span
                                    class="mt-1 block truncate text-muted-foreground"
                                >
                                    {trustedPublisherSummary(
                                        target.currentConfig,
                                    )}
                                </span>
                            </span>
                        </label>
                    {/each}
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onclick={() => (open = false)}
                    >{$_("common.cancel")}</Button
                >
                <Button
                    variant="brand"
                    disabled={selected.length === 0}
                    onclick={createBatch}
                >
                    <IconShield class="h-4 w-4" />
                    {$_("trustedPublishing.createEvent")}
                </Button>
            </DialogFooter>
        {:else if config}
            {#if canPreviewWorkflow}
                <div class="flex gap-1 rounded-md bg-muted/40 p-1">
                    <Button
                        variant={activeTab === "current" ? "brand" : "ghost"}
                        size="sm"
                        class="flex-1"
                        onclick={() => (activeTab = "current")}
                    >
                        <IconShield class="h-4 w-4" />
                        {$_("trustedPublishing.currentConfig")}
                    </Button>
                    <Button
                        variant={activeTab === "workflow" ? "brand" : "ghost"}
                        size="sm"
                        class="flex-1"
                        onclick={() => (activeTab = "workflow")}
                    >
                        <IconFileCode class="h-4 w-4" />
                        {$_("trustedPublishing.workflowTab")}
                    </Button>
                </div>
            {/if}
            {#if activeTab === "current"}
                <div
                    class="rounded-md border border-border bg-muted/30 p-3 text-xs"
                >
                    <div class="mb-2 flex items-center gap-2 font-medium">
                        <IconShield class="h-4 w-4 text-brand" />
                        {$_("trustedPublishing.currentConfig")}
                    </div>
                    <p class="break-words font-mono text-muted-foreground">
                        {trustedPublisherSummary(config)}
                    </p>
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onclick={() => createSingle("update")}
                    >
                        <IconPencil class="h-4 w-4" />
                        {$_("trustedPublishing.update")}
                    </Button>
                    <Button
                        variant="destructive"
                        onclick={() => createSingle("remove")}
                    >
                        <IconTrash class="h-4 w-4" />
                        {$_("trustedPublishing.remove")}
                    </Button>
                </DialogFooter>
            {:else}
                <div class="space-y-2">
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
                        <div
                            class="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground"
                        >
                            <span class="font-mono">{workflowPath}</span>
                            {#if workflowExists}
                                <span class="ml-2 text-warning"
                                    >{$_(
                                        "trustedPublishing.workflowExists",
                                    )}</span
                                >
                            {/if}
                        </div>
                        <pre
                            class="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed whitespace-pre-wrap">{workflowContent}</pre>
                    {/if}
                </div>
                <DialogFooter>
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
                </DialogFooter>
                {#if workflowExists && confirmWorkflowOverwrite}
                    <div
                        class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                        {$_("trustedPublishing.overwriteWarning")}
                        <Button
                            variant="ghost"
                            size="sm"
                            class="ml-2 h-6 px-2 text-[11px]"
                            onclick={() => (confirmWorkflowOverwrite = false)}
                            >{$_("common.cancel")}</Button
                        >
                    </div>
                {/if}
            {/if}
        {:else}
            <div
                class="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
            >
                {$_("trustedPublishing.createEventPending")}
            </div>
        {/if}
    </DialogContent>
</Dialog>
