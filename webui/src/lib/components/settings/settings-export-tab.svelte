<script lang="ts">
    /**
     * 导出 (Export / Import) settings tab — migrated from the former
     * `/backup` route (Chapter 8.2). Export builds an AES-256-GCM bundle
     * (PBKDF2-derived key); import shows the plaintext profile list first,
     * then asks for the password + selection. Adapted to dialog width (no
     * page header / grid layout — lives inside the Settings dialog body).
     *
     * `onImported` fires after a successful import so the host (SettingsDialog)
     * can close itself.
     */
    import * as InputGroup from "$lib/components/ui/input-group/index.js";
    import { Label } from "$lib/components/ui/label/index.js";
    import * as Tabs from "$lib/components/ui/tabs/index.js";
    import TooltipButton from "$lib/components/tooltip-button.svelte";
    import CopyButton from "$lib/components/copy-button.svelte";

    let { onImported }: { onImported?: (imported: string[]) => void } =
        $props();
    import {
        Card,
        CardContent,
        CardHeader,
        CardDescription,
    } from "$lib/components/ui/card/index.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { parseBackupBundleJson } from "$lib/backup-bundle.js";
    import { errorToMessage } from "$lib/error-projection.js";
    import { getRpcClient } from "$lib/store.js";
    import IconDownload from "@lucide/svelte/icons/download";
    import IconUpload from "@lucide/svelte/icons/upload";
    import IconEye from "@lucide/svelte/icons/eye";
    import IconEyeOff from "@lucide/svelte/icons/eye-off";
    import IconClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
    import IconSearch from "@lucide/svelte/icons/search";
    import { _ } from "svelte-i18n";

    /** Fixed filename used when downloading the generated backup bundle. */
    const BACKUP_FILENAME = "pnpm-pub-backup.json";

    type ImportPreview = { profiles: string[] } | null;

    let exportPassword = $state("");
    let exportPasswordVisible = $state(false);
    let exportResult = $state<string | null>(null);
    let exportError = $state<string | null>(null);

    let importBundle = $state("");
    let importPreview = $state<ImportPreview>(null);
    let importPassword = $state("");
    let importPasswordVisible = $state(false);
    let importSelected = $state<Set<string>>(new Set());
    let importError = $state<string | null>(null);
    let importDone = $state<string[] | null>(null);

    async function doExport(): Promise<void> {
        exportError = null;
        exportResult = null;
        try {
            const json = await getRpcClient()?.backup.export({
                password: exportPassword,
            });
            exportPassword = "";
            if (!json) {
                exportError = $_("backup.invalidDaemon");
                return;
            }
            if (json.ok) {
                exportResult = JSON.stringify(json.bundle, null, 2);
            } else {
                exportError = json.error ?? $_("backup.exportFailed");
            }
        } catch (err) {
            exportError = errorToMessage(err);
        }
    }

    function previewImport(): void {
        importError = null;
        importDone = null;
        const parsed = parseBackupBundleJson(importBundle);
        if (!parsed.ok) {
            if (parsed.reason === "invalid-json") {
                importError = $_("backup.invalidJson");
                return;
            }
            importError = $_("backup.invalidBackup");
            return;
        }
        importPreview = { profiles: parsed.bundle.profiles };
        importSelected = new Set(parsed.bundle.profiles);
    }

    async function doImport(): Promise<void> {
        importError = null;
        importDone = null;
        const parsed = parseBackupBundleJson(importBundle);
        if (!parsed.ok) {
            if (parsed.reason === "invalid-json") {
                importError = $_("backup.invalidJson");
                return;
            }
            importError = $_("backup.invalidBackup");
            return;
        }
        try {
            const bundle = parsed.bundle;
            const json = await getRpcClient()?.backup.import({
                bundle,
                password: importPassword,
                usernames: [...importSelected],
            });
            importPassword = "";
            if (!json) {
                importError = $_("backup.invalidDaemon");
                return;
            }
            if (json.ok) {
                importDone = json.imported ?? [];
                // Let the host close the dialog after a successful import.
                onImported?.(importDone);
            } else {
                importError = json.error ?? $_("backup.importFailed");
            }
        } catch (err) {
            importError = errorToMessage(err);
        }
    }

    function toggle(name: string): void {
        const next = new Set(importSelected);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        importSelected = next;
    }

    /** Paste the OS clipboard into the backup JSON field (best-effort). */
    async function pasteFromClipboard(): Promise<void> {
        try {
            const text = await navigator.clipboard.readText();
            if (text) importBundle = text.trim();
        } catch {
            /* clipboard may be unavailable (permissions / non-secure context) */
        }
    }

    function download(): void {
        if (!exportResult) return;
        const blob = new Blob([exportResult], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = BACKUP_FILENAME;
        a.click();
        URL.revokeObjectURL(url);
    }
</script>

<Tabs.Root value="export" class="gap-3">
    <!--
        The default active style (`data-active:bg-background`) is nearly
        invisible here because the dialog uses a translucent
        `bg-popover/80 backdrop-blur` surface, and `--background` vs the list's
        `--muted` read almost identical on top of it. We reinforce the active
        trigger with an accent fill + shadow so the selected tab is unambiguous.
    -->
    <Tabs.List variant="line">
        <Tabs.Trigger value="export"
            ><IconDownload class="size-4" /> {$_("backup.export")}</Tabs.Trigger
        >
        <Tabs.Trigger value="import"
            ><IconUpload class="size-4" /> {$_("backup.import")}</Tabs.Trigger
        >
    </Tabs.List>

    <!-- Export -->
    <Tabs.Content value="export">
        <Card>
            <CardHeader>
                <CardDescription>{$_("backup.exportIntro")}</CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col gap-4">
                <div class="flex flex-col gap-3">
                    <Label for="ep">{$_("backup.protectionPassword")}</Label>
                    <!-- InputGroup fuses the password field, a show/hide toggle, and the
				     generate action into one bordered control. The inner Input/Button
				     already drop their own chrome (data-slot=input-group-control), so we
				     only pass semantic props here — no border/ring overrides. -->
                    <InputGroup.Root>
                        <InputGroup.Input
                            id="ep"
                            type={exportPasswordVisible ? "text" : "password"}
                            bind:value={exportPassword}
                            placeholder={$_("backup.protectionPassword")}
                        />
                        <InputGroup.Addon align="inline-end">
                            <TooltipButton
                                variant="ghost"
                                label={$_(
                                    exportPasswordVisible
                                        ? "backup.hidePassword"
                                        : "backup.showPassword",
                                )}
                                side="top"
                                onclick={() =>
                                    (exportPasswordVisible =
                                        !exportPasswordVisible)}
                                tabindex={-1}
                            >
                                {#if exportPasswordVisible}<IconEyeOff
                                        class="size-4"
                                    />{:else}<IconEye class="size-4" />{/if}
                            </TooltipButton>
                        </InputGroup.Addon>
                        <InputGroup.Addon align="inline-end">
                            <TooltipButton
                                variant="brand"
                                label={$_("backup.generateBackup")}
                                side="top"
                                disabled={!exportPassword}
                                onclick={doExport}
                            >
                                <IconDownload class="size-4" />
                            </TooltipButton>
                        </InputGroup.Addon>
                    </InputGroup.Root>
                </div>
                {#if exportError}<p class="text-xs text-destructive">
                        {exportError}
                    </p>{/if}
                {#if exportResult}
                    <!--
					Read-only InputGroup holding the generated bundle JSON, with two
					icon-button addons: copy-to-clipboard and download. The download
					tooltip shows the target filename. Textarea actions sit in a
					block-end (bottom) toolbar, separated by a top border.
				-->
                    <InputGroup.Root>
                        <InputGroup.Textarea
                            readonly
                            rows={6}
                            class="max-h-40 overflow-auto font-mono text-[10px]"
                            aria-label={$_("backup.backupJson")}
                            value={exportResult}
                        />
                        <InputGroup.Addon
                            align="block-end"
                            class="border-t justify-end"
                        >
                            <CopyButton
                                value={() => exportResult ?? ""}
                                label={$_("common.copy")}
                                copiedLabel={$_("common.copied")}
                                tabindex={-1}
                            />
                            <TooltipButton
                                variant="brand"
                                label={BACKUP_FILENAME}
                                side="top"
                                onclick={download}
                            >
                                <IconDownload class="size-4" />
                            </TooltipButton>
                        </InputGroup.Addon>
                    </InputGroup.Root>
                {/if}
            </CardContent>
        </Card>
    </Tabs.Content>

    <!-- Import -->
    <Tabs.Content value="import">
        <Card>
            <CardHeader>
                <CardDescription>{$_("backup.importIntro")}</CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col gap-4">
                <div class="flex flex-col gap-3">
                    <div class="flex items-center justify-between">
                        <Label for="ib">{$_("backup.backupJson")}</Label>
                    </div>
                    <!--
					InputGroup wraps the multi-line backup JSON textarea with a unified
					border + focus ring. Both the paste (clipboard) and preview actions
					live as inline-end addons so the whole thing is one fused control.
				-->
                    <InputGroup.Root>
                        <InputGroup.Textarea
                            id="ib"
                            bind:value={importBundle}
                            rows={4}
                            class="max-h-48 font-mono text-[11px]"
                            placeholder={$_("backup.bundlePlaceholder")}
                        />
                        <InputGroup.Addon
                            align="block-end"
                            class="border-t justify-end"
                        >
                            <TooltipButton
                                variant="ghost"
                                label={$_("backup.paste")}
                                side="top"
                                onclick={pasteFromClipboard}
                                tabindex={-1}
                            >
                                <IconClipboardPaste class="size-4" />
                            </TooltipButton>
                            <TooltipButton
                                variant="outline"
                                label={$_("backup.previewProfiles")}
                                side="top"
                                disabled={!importBundle}
                                onclick={previewImport}
                            >
                                <IconSearch class="size-4" />
                            </TooltipButton>
                        </InputGroup.Addon>
                    </InputGroup.Root>
                </div>

                {#if importPreview}
                    <div
                        class="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5"
                    >
                        <div
                            class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                            {$_("backup.profilesInBackup")}
                        </div>
                        {#each importPreview.profiles as name (name)}
                            <label class="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={importSelected.has(name)}
                                    onchange={() => toggle(name)}
                                />
                                <span class="font-mono text-xs">{name}</span>
                            </label>
                        {/each}
                    </div>
                    <div class="flex flex-col gap-3">
                        <Label for="ip">{$_("backup.protectionPassword")}</Label
                        >
                        <InputGroup.Root>
                            <InputGroup.Input
                                id="ip"
                                type={importPasswordVisible
                                    ? "text"
                                    : "password"}
                                bind:value={importPassword}
                                placeholder={$_("backup.protectionPassword")}
                            />
                            <InputGroup.Addon align="inline-end">
                                <TooltipButton
                                    variant="ghost"
                                    label={$_(
                                        importPasswordVisible
                                            ? "backup.hidePassword"
                                            : "backup.showPassword",
                                    )}
                                    side="top"
                                    onclick={() =>
                                        (importPasswordVisible =
                                            !importPasswordVisible)}
                                    tabindex={-1}
                                >
                                    {#if importPasswordVisible}<IconEyeOff
                                            class="size-4"
                                        />{:else}<IconEye class="size-4" />{/if}
                                </TooltipButton>
                                <TooltipButton
                                    variant="brand"
                                    label={$_("backup.importProfiles", {
                                        values: { count: importSelected.size },
                                    })}
                                    side="top"
                                    disabled={!importPassword ||
                                        importSelected.size === 0}
                                    onclick={doImport}
                                >
                                    <IconUpload class="size-4" />
                                </TooltipButton>
                            </InputGroup.Addon>
                        </InputGroup.Root>
                    </div>
                {/if}

                {#if importError}<p class="text-xs text-destructive">
                        {importError}
                    </p>{/if}
                {#if importDone}
                    <div class="space-y-1">
                        <p class="text-xs text-success">
                            {$_("backup.imported")}
                        </p>
                        {#each importDone as u (u)}<Badge variant="success"
                                >{u}</Badge
                            >{/each}
                    </div>
                {/if}
            </CardContent>
        </Card>
    </Tabs.Content>
</Tabs.Root>
