<script lang="ts">
    /**
     * Global Settings dialog.
     *
     * Layout: a vertical section nav on the inline-start + a content pane. The
     * nav collapses to ICONS-ONLY (with tooltips) on narrow dialogs so it never
     * disappears entirely — at least the icons stay visible. Both the collapse
     * and the dialog's responsive layout are driven by CONTAINER QUERIES
     * (`@container settings-dialog`), not viewport breakpoints, because the
     * dialog is smaller than the viewport.
     *
     * Geometry: the opentray window uses `windowControlsOverlay`, so the top of
     * the document is the 2rem titlebar drag strip (the OS min/max/close cluster
     * lives in that band). The dialog must NOT overlap it and must keep ≥2rem of
     * margin from every edge of the body. We pin it to the band BELOW the
     * titlebar and clamp its max-height so it always fits with breathing room.
     *
     * Driven by the `ui` store (settingsOpen), mirroring AddProfileDialog.
     */
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import * as Tooltip from "$lib/components/ui/tooltip/index.js";
    import { cn } from "$lib/utils.js";
    import GeneralTab from "$lib/components/settings/general-tab.svelte";
    import PreferencesTab from "$lib/components/settings/preferences-tab.svelte";
    import ExportTab from "$lib/components/settings/settings-export-tab.svelte";
    import { closeSettings, ui } from "$lib/store.js";
    import { _ } from "svelte-i18n";
    import IconGeneral from "@lucide/svelte/icons/settings-2";
    import IconPreferences from "@lucide/svelte/icons/sliders-horizontal";
    import IconExport from "@lucide/svelte/icons/database-backup";

    type TabId = "general" | "preferences" | "export";

    const nav: { id: TabId; labelKey: string; icon: typeof IconGeneral }[] = [
        { id: "general", labelKey: "settings.general", icon: IconGeneral },
        {
            id: "preferences",
            labelKey: "settings.preferences",
            icon: IconPreferences,
        },
        { id: "export", labelKey: "settings.export", icon: IconExport },
    ];

    let open = $derived($ui.settingsOpen);
    let activeTab = $state<TabId>("general");

    function setOpen(next: boolean): void {
        ui.update((s) => ({ ...s, settingsOpen: next }));
    }

    const activeLabel = $derived(
        $_(nav.find((n) => n.id === activeTab)?.labelKey ?? "settings.title"),
    );

    // Reset to the first tab whenever the dialog re-opens.
    $effect(() => {
        if (open) activeTab = "general";
    });
</script>

{#snippet navItem(item: (typeof nav)[number])}
    {@const label = $_(item.labelKey)}
    <Tooltip.Root>
        <Tooltip.Trigger>
            {#snippet child({ props })}
                <button
                    type="button"
                    {...props}
                    onclick={() => (activeTab = item.id)}
                    aria-current={activeTab === item.id ? "page" : undefined}
                    class={cn(
                        // Default (narrow container): icon-only, centered.
                        // @[34rem] (wide container): full label, left-aligned.
                        "group/navitem flex w-full items-center justify-center gap-2.5 rounded-md px-2 py-2 text-center text-sm font-medium transition-colors @[34rem]:justify-start @[34rem]:px-3 @[34rem]:text-left",
                        activeTab === item.id
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                >
                    <item.icon class="size-4 shrink-0" />
                    <span class="truncate sr-only @[34rem]:not-sr-only"
                        >{label}</span
                    >
                </button>
            {/snippet}
        </Tooltip.Trigger>
        <!-- Tooltip only matters in icon mode; harmless in label mode. -->
        <Tooltip.Content side="right">{label}</Tooltip.Content>
    </Tooltip.Root>
{/snippet}

<Dialog.Root bind:open={() => open, setOpen}>
    <!--
		Position + size overrides on the shared DialogContent (which defaults to
		viewport-centered `top-1/2 -translate-y-1/2` and content-fit height):
		  - `top: calc(2rem + 50dvh)` shifts the center to the band BELOW the 2rem
		    titlebar (windowControlsOverlay) so the dialog never overlaps the OS
		    control cluster; `left-1/2 -translate-x-1/2` keeps it horizontally
		    centered.
		  - `height: 32rem` gives a STABLE target height so the dialog does NOT
		    shrink-to-fit its content — short tabs (e.g. preferences) keep the
		    same footprint as long ones (export). `max-height: calc(100dvh - 6rem)`
		    clamps it when the viewport is shorter than 32rem + 6rem of margin.
		  - `max-width: calc(100% - 4rem)` guarantees ≥2rem left + right margin;
		    `w-[min(100%,44rem)]` caps the ideal width.
		The whole content is a container query context the tabs key off of.
	-->
    <Dialog.Content
        class="@container settings-dialog grid w-[min(100%,44rem)] grid-rows-[auto_1fr] gap-0 overflow-hidden p-0 h-128"
        trapFocus={false}
        aria-describedby={undefined}
    >
        <Dialog.Title class="sr-only">{$_("settings.title")}</Dialog.Title>

        <!-- Compact section header (breadcrumb-style) so the current section is
		     always identifiable, even when the nav is icon-only. -->
        <header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <span
                class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
                {$_("settings.title")}
            </span>
            <span class="text-muted-foreground/50">/</span>
            <span class="text-sm font-medium">{activeLabel}</span>
        </header>

        <div class="grid min-h-0 flex-1 grid-cols-[auto_1fr]">
            <!-- Section nav. Default (narrow container): icon-only (`w-auto`,
			     labels sr-only); @[34rem] (wide): full labels (`w-44`). The nav
			     never fully disappears — icons + tooltips always remain. -->
            <nav
                class="flex w-auto flex-col gap-1 border-r p-2 @[34rem]:w-44"
                aria-label={$_("settings.title")}
            >
                {#each nav as item (item.id)}
                    {@render navItem(item)}
                {/each}
            </nav>

            <div class="min-h-0 overflow-y-auto p-4">
                {#if activeTab === "general"}
                    <GeneralTab />
                {:else if activeTab === "preferences"}
                    <PreferencesTab />
                {:else}
                    <ExportTab onImported={() => setOpen(false)} />
                {/if}
            </div>
        </div>
    </Dialog.Content>
</Dialog.Root>
