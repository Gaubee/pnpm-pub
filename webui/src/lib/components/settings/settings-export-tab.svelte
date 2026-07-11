<script lang="ts">
  /**
   * 导出 (Export / Import) settings tab — migrated from the former
   * `/backup` route (Chapter 8.2). Export builds an AES-256-GCM bundle
   * (PBKDF2-derived key); import is delegated to the shared profile-import
   * atom used by add-profile too. Adapted to dialog width (no page header /
   * grid layout — lives inside the Settings dialog body).
   *
   * `onImported` fires after a successful import so the host (SettingsDialog)
   * can close itself.
   */
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import TooltipButton from "$lib/components/tooltip-button.svelte";
  import CopyButton from "$lib/components/copy-button.svelte";
  import DownloadButton from "$lib/components/download-button.svelte";
  import ProfileImportForm from "$lib/components/profile-import-form.svelte";

  let { onImported }: { onImported?: (imported: string[]) => void } = $props();
  import { Card, CardContent, CardHeader, CardDescription } from "$lib/components/ui/card/index.js";
  import { errorToMessage } from "$lib/error-projection.js";
  import { getRpcClient } from "$lib/store.js";
  import IconDownload from "@lucide/svelte/icons/download";
  import IconUpload from "@lucide/svelte/icons/upload";
  import IconEye from "@lucide/svelte/icons/eye";
  import IconEyeOff from "@lucide/svelte/icons/eye-off";
  import { _ } from "svelte-i18n";

  /** Fixed filename used when downloading the generated backup bundle. */
  const BACKUP_FILENAME = "pnpm-pub-backup.json";

  let exportPassword = $state("");
  let exportPasswordVisible = $state(false);
  let exportResult = $state<string | null>(null);
  let exportError = $state<string | null>(null);

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
</script>

<Tabs.Root value="export" class="gap-3">
  <!--
        The default active style (`data-active:bg-background`) is nearly
        invisible here because the dialog uses a translucent
        `bg-popover/80 backdrop-blur` surface, and `--background` vs the list's
        `--muted` read almost identical on top of it. We reinforce the active
        trigger with an accent fill + shadow so the selected tab is unambiguous.
    -->
  <Tabs.List variant="default">
    <Tabs.Trigger value="export"><IconDownload class="size-4" /> {$_("backup.export")}</Tabs.Trigger
    >
    <Tabs.Trigger value="import"><IconUpload class="size-4" /> {$_("backup.import")}</Tabs.Trigger>
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
                label={$_(exportPasswordVisible ? "backup.hidePassword" : "backup.showPassword")}
                side="top"
                onclick={() => (exportPasswordVisible = !exportPasswordVisible)}
                tabindex={-1}
              >
                {#if exportPasswordVisible}<IconEyeOff class="size-4" />{:else}<IconEye
                    class="size-4"
                  />{/if}
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
            <InputGroup.Addon align="block-end" class="border-t justify-end">
              <CopyButton
                value={() => exportResult ?? ""}
                label={$_("common.copy")}
                copiedLabel={$_("common.copied")}
                tabindex={-1}
              />
              <DownloadButton
                value={() => exportResult ?? ""}
                filename={BACKUP_FILENAME}
                mime="application/json"
                label={$_("common.download")}
                doneLabel={BACKUP_FILENAME}
                tabindex={-1}
              />
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
        <ProfileImportForm idPrefix="settings-profile-import" {onImported} />
      </CardContent>
    </Card>
  </Tabs.Content>
</Tabs.Root>
