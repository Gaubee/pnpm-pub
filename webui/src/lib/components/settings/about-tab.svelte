<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as ButtonGroup from "$lib/components/ui/button-group/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Accordion from "$lib/components/ui/accordion/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { actions, daemon } from "$lib/store.js";
  import AppMark from "$lib/components/app-mark.svelte";
  import BrandIcon from "$lib/components/brand-icon.svelte";
  import IconArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import IconCheck from "@lucide/svelte/icons/check";
  import IconAlertTriangle from "@lucide/svelte/icons/triangle-alert";
  import IconBadgeInfo from "@lucide/svelte/icons/badge-info";
  import IconChevronRight from "@lucide/svelte/icons/chevron-right";
  import IconDownload from "@lucide/svelte/icons/download";
  import IconRefreshCw from "@lucide/svelte/icons/refresh-cw";
  import IconRotateCw from "@lucide/svelte/icons/rotate-cw";
  import { onMount } from "svelte";
  import { _ } from "svelte-i18n";

  const update = $derived($daemon.appUpdate);
  const updateAvailable = $derived(update.status === "available");
  const checking = $derived(update.status === "checking");
  const installing = $derived(update.status === "installing");
  const installFailed = $derived(update.status === "install-failed");
  const readyToRestart = $derived(update.status === "ready-to-restart");
  const canInstall = $derived((updateAvailable || installFailed) && update.owner.canUpdate);
  const upToDate = $derived(update.status === "up-to-date");
  const runtimeInfo = $derived($daemon.runtimeInfo);
  const lastLogLine = $derived(update.logs.at(-1) ?? "");
  const showUpdateLog = $derived(update.logs.length > 0 || installing || installFailed || readyToRestart);
  let logExpanded = $state(false);
  let logContainer = $state<HTMLDivElement>();
  let clock = $state(Date.now());
  const restartSeconds = $derived(
    update.restartAt === null ? null : Math.max(0, Math.ceil((update.restartAt - clock) / 1000)),
  );

  onMount(() => {
    const timer = window.setInterval(() => (clock = Date.now()), 250);
    return () => window.clearInterval(timer);
  });

  $effect(() => {
    const logCount = update.logs.length;
    if (logExpanded && logCount > 0) logContainer?.scrollTo({ top: logContainer.scrollHeight });
  });

  function formatTimestamp(value: number | null): string {
    if (!value) return $_("settings.aboutNotChecked");
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      value,
    );
  }
</script>

<div class="flex flex-col gap-4">
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

    {#if update.error && !installFailed && !readyToRestart}
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
              disabled={checking || installing || readyToRestart}
              onclick={() => void actions.checkAppUpdate()}
            >
              {#if checking}<Spinner />{:else}<IconRefreshCw />{/if}
              {$_("settings.checkForUpdates")}
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content
          >{$_("settings.aboutLastChecked", {
            values: { time: formatTimestamp(update.lastCheckedAt) },
          })}</Tooltip.Content
        >
      </Tooltip.Root>
      {#if readyToRestart}
        <ButtonGroup.Root>
          <Button variant="brand" size="sm" onclick={() => void actions.restartAfterAppUpdate()}>
            <IconRotateCw />
            {#if restartSeconds === null || restartSeconds === 0}
              {$_("settings.restart")}
            {:else}
              {$_("settings.restartCountdown", { values: { seconds: restartSeconds } })}
            {/if}
          </Button>
          {#if update.restartAt !== null}
            <Button variant="outline" size="sm" onclick={() => void actions.cancelAppUpdateRestart()}>
              {$_("common.cancel")}
            </Button>
          {/if}
        </ButtonGroup.Root>
      {:else if updateAvailable || installFailed || installing}
        <Button
          variant="brand"
          size="sm"
          disabled={!canInstall || installing}
          onclick={() => void actions.installAppUpdate()}
        >
          {#if installing}<Spinner />{:else}<IconDownload />{/if}
          {installing
            ? $_("settings.updating")
            : installFailed
              ? $_("settings.retryUpdate")
              : $_("settings.updateNow")}
        </Button>
      {/if}
    </div>

    {#if showUpdateLog}
      <div
        class="rounded-md border {installFailed
          ? 'border-destructive/40'
          : readyToRestart
            ? 'border-success/30'
            : 'border-border'}"
      >
        <button
          type="button"
          class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/40 {installFailed
            ? 'text-destructive'
            : readyToRestart
              ? 'text-success'
              : 'text-muted-foreground'}"
          onclick={() => (logExpanded = !logExpanded)}
          aria-expanded={logExpanded}
        >
          <IconChevronRight
            class="size-3 shrink-0 transition-transform {logExpanded ? 'rotate-90' : ''}"
          />
          {#if installFailed}
            <IconAlertTriangle class="size-3 shrink-0" />
          {:else if readyToRestart}
            <IconBadgeInfo class="size-3 shrink-0" />
          {:else}
            <Spinner class="size-3" />
          {/if}
          <span class="shrink-0 font-medium">
            {installFailed
              ? $_("settings.updateFailed")
              : readyToRestart
                ? $_("settings.updateSuccessful")
                : $_("settings.updateLog")}:
          </span>
          {#if !logExpanded}
            <span class="truncate font-mono">{lastLogLine}</span>
          {/if}
        </button>
        {#if logExpanded}
          <div
            bind:this={logContainer}
            class="max-h-48 overflow-auto border-t px-3 py-2 font-mono text-[11px] whitespace-pre-wrap break-words {installFailed
              ? 'border-destructive/40 text-destructive'
              : readyToRestart
                ? 'border-success/30 text-success'
                : 'border-border text-muted-foreground'}"
          >{update.logs.join("\n")}</div>
        {/if}
      </div>
    {/if}
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

  <!-- Daemon facts are projected from the running process, including any
       PNPM_PUB_HOME override. Secrets are named by backend, never displayed. -->
  {#if runtimeInfo}
    <Accordion.Root type="single" class="border-t">
      <Accordion.Item value="daemon">
        <Accordion.Trigger class="py-4 hover:no-underline">
          <span class="flex min-w-0 flex-1 items-center justify-between gap-3 pr-2">
            <span class="text-xs font-medium text-muted-foreground"
              >{$_("settings.aboutDaemon")}</span
            >
            <span class="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
              {runtimeInfo.platform} · PID {runtimeInfo.pid}
            </span>
          </span>
        </Accordion.Trigger>
        <Accordion.Content class="pb-4">
          <dl class="grid gap-x-3 gap-y-2 text-xs @[34rem]:grid-cols-[auto_minmax(0,1fr)]">
            <dt class="text-muted-foreground">{$_("settings.aboutDataDir")}</dt>
            <dd class="min-w-0 break-all font-mono">{runtimeInfo.appDir}</dd>
            <dt class="text-muted-foreground">{$_("settings.aboutProfilesPath")}</dt>
            <dd class="min-w-0 break-all font-mono">{runtimeInfo.profilesPath}</dd>
            <dt class="text-muted-foreground">{$_("settings.aboutCredentials")}</dt>
            <dd class="min-w-0 break-words">
              {$_("settings.aboutCredentialService", {
                values: { service: runtimeInfo.credentialService },
              })}
            </dd>
            <dt class="text-muted-foreground">{$_("settings.aboutEventsPath")}</dt>
            <dd class="min-w-0 break-all font-mono">{runtimeInfo.eventsDbPath}</dd>
            <dt class="text-muted-foreground">{$_("settings.aboutLogPath")}</dt>
            <dd class="min-w-0 break-all font-mono">{runtimeInfo.daemonLogPath}</dd>
          </dl>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  {/if}
</div>
