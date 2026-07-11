<script lang="ts">
  /**
   * Shared profile-backup import atom. The browser owns only preview and
   * selection state; the daemon remains the sole writer of profile metadata and
   * keychain credentials through `backup.import`.
   */
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import TooltipButton from "$lib/components/tooltip-button.svelte";
  import { parseBackupBundleJson } from "$lib/backup-bundle.js";
  import { errorToMessage } from "$lib/error-projection.js";
  import { getRpcClient } from "$lib/store.js";
  import IconClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
  import IconEye from "@lucide/svelte/icons/eye";
  import IconEyeOff from "@lucide/svelte/icons/eye-off";
  import IconFileUp from "@lucide/svelte/icons/file-up";
  import IconSearch from "@lucide/svelte/icons/search";
  import IconUpload from "@lucide/svelte/icons/upload";
  import { _ } from "svelte-i18n";

  let {
    idPrefix = "profile-import",
    onImported,
  }: {
    /** Host-scoped prefix so labels remain unique when two import surfaces coexist. */
    idPrefix?: string;
    onImported?: (imported: string[]) => void;
  } = $props();

  const jsonId = $derived(`${idPrefix}-json`);
  const passwordId = $derived(`${idPrefix}-password`);

  let fileInput = $state<HTMLInputElement | null>(null);
  let bundleJson = $state("");
  let preview = $state<string[] | null>(null);
  let password = $state("");
  let passwordVisible = $state(false);
  let selected = $state<Set<string>>(new Set());
  let error = $state<string | null>(null);
  let imported = $state<string[] | null>(null);
  let busy = $state(false);

  function clearPreview(): void {
    preview = null;
    selected = new Set();
    imported = null;
    error = null;
  }

  function setBundleJson(value: string): void {
    bundleJson = value;
    clearPreview();
  }

  function previewBundle(): boolean {
    error = null;
    imported = null;
    const parsed = parseBackupBundleJson(bundleJson);
    if (!parsed.ok) {
      preview = null;
      selected = new Set();
      error = $_(parsed.reason === "invalid-json" ? "backup.invalidJson" : "backup.invalidBackup");
      return false;
    }
    preview = parsed.bundle.profiles;
    selected = new Set(parsed.bundle.profiles);
    return true;
  }

  async function chooseFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      setBundleJson(await file.text());
      previewBundle();
    } catch (cause) {
      error = errorToMessage(cause);
    }
  }

  async function pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setBundleJson(text.trim());
    } catch {
      error = $_("backup.clipboardUnavailable");
    }
  }

  function toggle(name: string, checked: boolean): void {
    const next = new Set(selected);
    if (checked) next.add(name);
    else next.delete(name);
    selected = next;
  }

  async function importProfiles(): Promise<void> {
    if (busy || !password || selected.size === 0) return;
    const parsed = parseBackupBundleJson(bundleJson);
    if (!parsed.ok) {
      previewBundle();
      return;
    }
    busy = true;
    error = null;
    imported = null;
    try {
      const result = await getRpcClient()?.backup.import({
        bundle: parsed.bundle,
        password,
        usernames: [...selected],
      });
      password = "";
      if (!result) {
        error = $_("backup.invalidDaemon");
      } else if (result.ok) {
        imported = result.imported ?? [];
        onImported?.(imported);
      } else {
        error = result.error ?? $_("backup.importFailed");
      }
    } catch (cause) {
      error = errorToMessage(cause);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-2">
    <Label for={jsonId}>{$_("backup.backupJson")}</Label>
    <InputGroup.Root class="border-black/50">
      <InputGroup.Textarea
        id={jsonId}
        value={bundleJson}
        oninput={(event) => setBundleJson(event.currentTarget.value)}
        rows={5}
        class="max-h-48 font-mono text-[11px]"
        placeholder={$_("backup.bundlePlaceholder")}
        disabled={busy}
      />
      <InputGroup.Addon align="block-end" class="flex-wrap justify-between border-t">
        <Button variant="ghost" size="sm" onclick={() => fileInput?.click()} disabled={busy}>
          <IconFileUp data-icon="inline-start" />
          {$_("backup.chooseFile")}
        </Button>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onclick={pasteFromClipboard} disabled={busy}>
            <IconClipboardPaste data-icon="inline-start" />
            {$_("backup.paste")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onclick={previewBundle}
            disabled={busy || !bundleJson.trim()}
          >
            <IconSearch data-icon="inline-start" />
            {$_("backup.previewProfiles")}
          </Button>
        </div>
      </InputGroup.Addon>
    </InputGroup.Root>
    <input
      bind:this={fileInput}
      class="hidden"
      type="file"
      accept="application/json,.json"
      onchange={chooseFile}
    />
  </div>

  {#if preview}
    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium">{$_("backup.profilesInBackup")}</legend>
      <div class="flex max-h-32 flex-col gap-1.5 overflow-y-auto rounded-md bg-muted/40 p-2.5">
        {#each preview as name (name)}
          <div class="flex items-center gap-2">
            <Checkbox
              id={`${idPrefix}-${name}`}
              checked={selected.has(name)}
              onCheckedChange={(checked) => toggle(name, checked)}
              disabled={busy}
            />
            <Label
              for={`${idPrefix}-${name}`}
              class="min-w-0 flex-1 truncate font-mono text-xs font-normal"
            >
              {name}
            </Label>
          </div>
        {/each}
      </div>
    </fieldset>

    <div class="flex flex-col gap-2">
      <Label for={passwordId}>{$_("backup.protectionPassword")}</Label>
      <InputGroup.Root class="border-black/50">
        <InputGroup.Input
          id={passwordId}
          type={passwordVisible ? "text" : "password"}
          bind:value={password}
          autocomplete="current-password"
          placeholder={$_("backup.protectionPassword")}
          disabled={busy}
          onkeydown={(event) => {
            if (event.key === "Enter") void importProfiles();
          }}
        />
        <InputGroup.Addon align="inline-end">
          <TooltipButton
            variant="ghost"
            label={$_(passwordVisible ? "backup.hidePassword" : "backup.showPassword")}
            side="top"
            onclick={() => (passwordVisible = !passwordVisible)}
            disabled={busy}
            tabindex={-1}
          >
            {#if passwordVisible}<IconEyeOff />{:else}<IconEye />{/if}
          </TooltipButton>
        </InputGroup.Addon>
      </InputGroup.Root>
      <Button
        variant="brand"
        class="w-full"
        onclick={importProfiles}
        disabled={busy || !password || selected.size === 0}
      >
        {#if busy}
          <Spinner data-icon="inline-start" />
        {:else}
          <IconUpload data-icon="inline-start" />
        {/if}
        {$_(busy ? "backup.importing" : "backup.importProfiles", {
          values: { count: selected.size },
        })}
      </Button>
    </div>
  {/if}

  {#if error}
    <p class="text-xs text-destructive" role="alert">{error}</p>
  {/if}
  {#if imported}
    <p class="text-xs text-success">
      {$_("backup.importedCount", { values: { count: imported.length } })}
    </p>
  {/if}
</div>
