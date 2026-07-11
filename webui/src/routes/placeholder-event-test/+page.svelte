<!-- Browser-regression host for the placeholder publish lifecycle. -->
<script lang="ts">
  import EventCard from "$lib/components/event-card.svelte";
  import type { EventStatus, PubEvent } from "$lib/types.js";

  function placeholderEvent(id: string, status: EventStatus): PubEvent {
    return {
      id,
      kind: "create-placeholder",
      status,
      profile: "alice",
      createdAt: Number(id),
      ...(status === "pending" ? {} : { resolvedAt: Number(id) + 1 }),
      ...(status === "failed" ? { result: "registry unavailable" } : {}),
      ...(status === "success" ? { result: "[publish] + @Gaubee/Reserved-Name@0.0.0" } : {}),
      payload: {
        kind: "create-placeholder",
        data: {
          name: "@Gaubee/Reserved-Name",
          args: ["--access", "public"],
        },
      },
    };
  }

  const pending = placeholderEvent("1", "pending");
  const failed = placeholderEvent("2", "failed");
  const success = placeholderEvent("3", "success");
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-5 p-6">
  <section data-testid="placeholder-pending"><EventCard event={pending} /></section>
  <section data-testid="placeholder-failed"><EventCard event={failed} /></section>
  <section data-testid="placeholder-success"><EventCard event={success} /></section>
</div>
