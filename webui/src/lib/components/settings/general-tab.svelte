<script lang="ts">
    /**
     * 通用 (General) settings tab — theme + language.
     *
     * Theme is a 3-segment ButtonGroup (system/light/dark, icon + label); the
     * active segment uses the `secondary` variant. Language is a Combobox
     * (Popover + Command) so the 9 locales live in a searchable dropdown rather
     * than a long Toggle row. Both re-flow on narrow widths via container
     * queries (`@container settings-dialog` is set on the dialog body).
     */
    import { Button } from "$lib/components/ui/button/index.js";
    import { ButtonGroup } from "$lib/components/ui/button-group/index.js";
    import { Label } from "$lib/components/ui/label/index.js";
    import * as Popover from "$lib/components/ui/popover/index.js";
    import {
        Command,
        CommandEmpty,
        CommandGroup,
        CommandInput,
        CommandItem,
        CommandList,
    } from "$lib/components/ui/command/index.js";
    import IconCheck from "@lucide/svelte/icons/check";
    import IconChevronDown from "@lucide/svelte/icons/chevron-down";
    import IconSun from "@lucide/svelte/icons/sun";
    import IconMoon from "@lucide/svelte/icons/moon";
    import IconMonitor from "@lucide/svelte/icons/monitor";
    import { userPrefersMode, setMode } from "mode-watcher";
    import { _, locale } from "svelte-i18n";
    import {
        localeNames,
        locales,
        setAppLocale,
        type AppLocale,
    } from "$lib/i18n.js";

    type ThemeMode = "system" | "light" | "dark";
    // Labels drop the legacy "Theme: " prefix — the section header already says
    // 主题/Theme, so the buttons read "System / Light / Dark".
    const themeOptions: {
        id: ThemeMode;
        icon: typeof IconSun;
        labelKey: string;
    }[] = [
        { id: "system", icon: IconMonitor, labelKey: "settings.modeSystem" },
        { id: "light", icon: IconSun, labelKey: "settings.modeLight" },
        { id: "dark", icon: IconMoon, labelKey: "settings.modeDark" },
    ];

    const currentMode = $derived(userPrefersMode.current as ThemeMode);
    const currentLocale = $derived(($locale ?? "en") as AppLocale);
    let langOpen = $state(false);
</script>

<div class="space-y-6">
    <!-- Theme -->
    <div class="flex flex-col gap-3">
        <Label>{$_("settings.theme")}</Label>
        <ButtonGroup class="w-full">
            {#each themeOptions as opt (opt.id)}
                <Button
                    variant={currentMode === opt.id ? "secondary" : "outline"}
                    class="flex-1 gap-1.5"
                    onclick={() => setMode(opt.id)}
                    aria-pressed={currentMode === opt.id}
                >
                    <opt.icon class="h-4 w-4" />
                    {$_(opt.labelKey)}
                </Button>
            {/each}
        </ButtonGroup>
    </div>

    <!-- Language (Combobox = Popover + Command). The trigger is styled directly
         on Popover.Trigger (no child-snippet wrapping a <Button>) so bits-ui's
         floating-ui anchor action binds cleanly to the trigger element — a
         wrapped Svelte component can drop the use: action and make the popover
         drift off the trigger. -->
    <div class="flex flex-col gap-3">
        <Label>{$_("settings.language")}</Label>
        <Popover.Root bind:open={langOpen}>
            <Popover.Trigger
                class="inline-flex h-9 w-fit items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-1 text-sm font-normal shadow-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
                <span>{localeNames[currentLocale]}</span>
                <IconChevronDown class="size-4 opacity-50" />
            </Popover.Trigger>
            <Popover.Content class="w-56 p-0" align="start" sideOffset={4}>
                <Command
                    filter={(value, search) =>
                        value.toLowerCase().includes(search.toLowerCase())
                            ? 0
                            : 1}
                >
                    <CommandInput placeholder={$_("settings.searchLanguage")} />
                    <CommandList>
                        <CommandEmpty
                            >{$_("settings.noLanguageFound")}</CommandEmpty
                        >
                        <CommandGroup>
                            {#each locales as lang (lang)}
                                <CommandItem
                                    value={`${localeNames[lang]} ${lang}`}
                                    onSelect={() => {
                                        setAppLocale(lang);
                                        langOpen = false;
                                    }}
                                >
                                    {localeNames[lang]}
                                    <IconCheck
                                        class="ml-auto {currentLocale === lang
                                            ? 'opacity-100'
                                            : 'opacity-0'}"
                                    />
                                </CommandItem>
                            {/each}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </Popover.Content>
        </Popover.Root>
    </div>
</div>
