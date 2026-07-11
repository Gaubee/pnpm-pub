<script lang="ts">
  /** Add-profile mode shell shared by the onboarding route and add dialog. */
  import AddProfileForm from "$lib/components/add-profile-form.svelte";
  import ProfileImportForm from "$lib/components/profile-import-form.svelte";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconUpload from "@lucide/svelte/icons/upload";
  import { _ } from "svelte-i18n";
  import { Avatar, AvatarFallback } from "./ui/avatar";

  let {
    onSuccess,
    onImported,
    mode = "add",
    username,
  }: {
    onSuccess: (username: string) => void;
    onImported: (imported: string[]) => void;
    mode?: "add" | "reauth";
    username?: string;
  } = $props();
</script>

{#if mode === "reauth"}
  <AddProfileForm mode="reauth" {username} {onSuccess} />
{:else}
  <Tabs.Root value="add" class="gap-4">
    <Tabs.List class="grid w-full grid-cols-2">
      <Tabs.Trigger value="add">
        <IconPlus data-icon="inline-start" />
        {$_("addProfile.addMode")}
      </Tabs.Trigger>
      <Tabs.Trigger value="import">
        <IconUpload data-icon="inline-start" />
        {$_("backup.import")}
      </Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="add">
      <!-- class="p-3 rounded-lg backdrop-brightness-120 backdrop-contrast-80 dark:backdrop-brightness-80 dark:backdrop-contrast-120" -->
      <AddProfileForm {onSuccess} />
    </Tabs.Content>
    <Tabs.Content value="import">
      <!-- class="p-3 rounded-lg backdrop-brightness-120 backdrop-contrast-80 dark:backdrop-brightness-80 dark:backdrop-contrast-120" -->
      <div class="flex flex-col gap-4">
        <div class="flex flex-row items-center gap-3">
          <Avatar class="h-10 w-10 shrink-0 border border-border">
            <AvatarFallback>
              <IconUpload class="h-5 w-5 text-muted-foreground" />
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 class="text-sm font-medium">{$_("addProfile.importHeading")}</h2>
            <p class="mt-1 text-xs text-muted-foreground">{$_("backup.importIntro")}</p>
          </div>
        </div>
        <ProfileImportForm idPrefix="add-profile-import" {onImported} />
      </div>
    </Tabs.Content>
  </Tabs.Root>
{/if}
