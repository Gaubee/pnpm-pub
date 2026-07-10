<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { actions, daemon } from "$lib/store.js";
  import AppMark from "$lib/components/app-mark.svelte";
  import BrandIcon from "$lib/components/brand-icon.svelte";
  import IconArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import IconCheck from "@lucide/svelte/icons/check";
  import IconDownload from "@lucide/svelte/icons/download";
  import IconLoaderCircle from "@lucide/svelte/icons/loader-circle";
  import IconRefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { _ } from "svelte-i18n";

  const update = $derived($daemon.appUpdate);
  const updateAvailable = $derived(update.status === "available");
  const checking = $derived(update.status === "checking");
  const installing = $derived(update.status === "installing");
  const canInstall = $derived(updateAvailable && update.owner.canUpdate);
  const upToDate = $derived(update.status === "up-to-date");

  function formatTimestamp(value: number | null): string {
    if (!value) return $_("settings.aboutNotChecked");
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
  }
</script>

<div class="flex flex-col gap-6">
  <!-- Hero: identity + version + status, all in one block. The version line
       uses an arrow (1.2.3 → 1.3.0) when an update exists so "current" and
       "latest" read as one relationship instead of two detached rows. -->
  <section class="space-y-3">
    <div class="flex items-start gap-3">
      <!-- AppMark has sharp corners by design — do NOT add rounded-*. -->
      <AppMark class="size-10 shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-base font-semibold leading-tight">pnpm-pub</h2>
          {#if updateAvailable}
            <Badge variant="default" class="gap-1">
              <IconDownload class="size-3" />
              {$_("settings.updateAvailable")}
            </Badge>
          {:else if upToDate}
            <Badge variant="secondary" class="gap-1">
              <IconCheck class="size-3" />
              {$_("settings.updateCurrent")}
            </Badge>
          {/if}
        </div>
        <p class="mt-0.5 text-sm tabular-nums">
          <span class="font-medium">{update.currentVersion}</span>
          {#if updateAvailable}
            <span class="mx-1 text-muted-foreground">→</span>
            <span class="font-medium text-brand">{update.latestVersion}</span>
          {/if}
        </p>
      </div>
    </div>

    {#if update.error}
      <p class="text-xs text-destructive">{update.error}</p>
    {:else if updateAvailable && !update.owner.canUpdate}
      <p class="text-xs text-muted-foreground">{update.owner.reason}</p>
    {/if}

    <div class="flex flex-wrap gap-2">
      <!-- "Last checked" lives on the Check button's tooltip instead of a
           dedicated row — hover reveals when we last asked the registry. -->
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="outline"
              size="sm"
              disabled={checking || installing}
              onclick={() => void actions.checkAppUpdate()}
            >
              {#if checking}<IconLoaderCircle class="animate-spin" />{:else}<IconRefreshCw />{/if}
              {$_("settings.checkForUpdates")}
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{$_("settings.aboutLastChecked", { values: { time: formatTimestamp(update.lastCheckedAt) } })}</Tooltip.Content>
      </Tooltip.Root>
      {#if updateAvailable}
        <Button variant="brand" size="sm" disabled={!canInstall || installing} onclick={() => void actions.installAppUpdate()}>
          {#if installing}<IconLoaderCircle class="animate-spin" />{:else}<IconDownload />{/if}
          {$_("settings.updateNow")}
        </Button>
      {/if}
    </div>
  </section>

  <!-- Runtime toolchain (this machine's npm / pnpm). Compact single row. -->
  <section class="flex items-center gap-4 border-t pt-4 text-sm">
    <span class="text-xs font-medium text-muted-foreground">{$_("settings.aboutRuntime")}</span>
    <span class="flex items-center gap-1.5">
      <BrandIcon id="npm" class="size-3.5" />
      <code class="tabular-nums">{update.runtimeVersions.npm ?? "—"}</code>
    </span>
    <span class="flex items-center gap-1.5">
      <BrandIcon id="pnpm" class="size-3.5" />
      <code class="tabular-nums">{update.runtimeVersions.pnpm ?? "—"}</code>
    </span>
  </section>

  <!-- Footer: lightweight text links, no bordered buttons. -->
  <footer class="flex items-center gap-3 border-t pt-4 text-xs text-muted-foreground">
    <button
      type="button"
      class="inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
      onclick={() => void actions.openUrl("https://github.com/Gaubee/pnpm-pub")}
    >
      <BrandIcon id="github" monochrome class="size-3.5" />
      {$_("settings.aboutGithub")}
      <IconArrowUpRight class="size-3" />
    </button>
    <span class="text-muted-foreground/40">·</span>
    <button
      type="button"
      class="inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
      onclick={() => void actions.openUrl("https://www.npmjs.com/package/pnpm-pub")}
    >
      <BrandIcon id="npm" class="size-3.5" />
      {$_("settings.aboutNpm")}
      <IconArrowUpRight class="size-3" />
    </button>
  </footer>
</div>
