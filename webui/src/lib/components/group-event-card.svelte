<script lang="ts">
    /**
     * GroupEventCard — an inline, self-contained batch card for events sharing
     * a `groupId`. Heavy editing lives in two places:
     *
     *   1. A default `TrustFormCard` (trusted-publishing groups only) whose
     *      edits fan out to every inherit-mode member.
     *   2. Events accordion — one-line member rows (status dot + name + custom
     *      hint). Clicking a row opens an `EventDetailDialog` for that member's
     *      full editing surface.
     *
     * Batch confirm/reject sit above the form/accordion so they're always
     * reachable.
     *
     * Front-end state only: inherit/custom modes + which member is expanded +
     * accordion states are local and reset on reload.
     */
    import type { EventStatus, PubEvent } from "$lib/types.js";
    import type { EventGroup, GroupKind } from "$lib/group-event.js";
    import { aggregateGroupStatus } from "$lib/group-event.js";
    import {
        Badge,
        type BadgeVariant,
    } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import {
        ButtonGroup,
        ButtonGroupSeparator,
    } from "$lib/components/ui/button-group/index.js";
    import {
        Card,
        CardContent,
        CardHeader,
    } from "$lib/components/ui/card/index.js";
    import {
        isMemberInheriting,
        resolveTrustedPublishingConfig,
        trustedPublisherSummary,
    } from "$lib/trusted-publishing.js";
    import EventDetailDialog from "$lib/components/event-detail-dialog.svelte";
    import EventIconBadge from "$lib/components/event-icon-badge.svelte";
    import TrustFormCard from "$lib/components/trust-form-card.svelte";
    import { actions, daemon } from "$lib/store.js";
    import AutoCloseBar from "$lib/components/auto-close-bar.svelte";
    import IconShield from "@lucide/svelte/icons/shield-check";
    import IconPublish from "@lucide/svelte/icons/upload";
    import IconLayers from "@lucide/svelte/icons/layers";
    import IconCheck from "@lucide/svelte/icons/check";
    import IconX from "@lucide/svelte/icons/x";
    import IconRotateCw from "@lucide/svelte/icons/rotate-cw";
    import IconReset from "@lucide/svelte/icons/refresh-ccw";
    import IconChevronRight from "@lucide/svelte/icons/chevron-right";
    import IconClock from "@lucide/svelte/icons/clock";
    import { _ } from "svelte-i18n";
    import { untrack } from "svelte";
    import { fade } from "svelte/transition";
    import { flip } from "svelte/animate";
    import { flipParams, enterParams, leaveParams } from "$lib/transitions.js";

    let {
        group,
        surface = "pending",
        autoClose = false,
        onAutoClose,
    }: {
        group: EventGroup;
        surface?: "pending" | "history";
        autoClose?: boolean;
        onAutoClose?: () => void;
    } = $props();

    const STATUS_VARIANTS = {
        pending: "brand",
        success: "success",
        failed: "destructive",
        expired: "warning",
        "action-required": "warning",
        rejected: "secondary",
    } satisfies Record<EventStatus, NonNullable<BadgeVariant>>;

    const KIND_ICON: Record<GroupKind, typeof IconLayers> = {
        "trusted-publishing": IconShield,
        publish: IconPublish,
        mixed: IconLayers,
    };
    /** Icon-tile tint per kind: trusted-publishing → success (green), publish →
     *  brand (blue), mixed → neutral. Mirrors EventCard's kindAccent signal. */
    const KIND_ICON_CLASS: Record<GroupKind, string> = {
        "trusted-publishing": "bg-success/10 text-success border-success/38",
        publish: "bg-brand/10 text-brand border-brand/38",
        mixed: "bg-accent text-muted-foreground  border-muted/38",
    };
    /** CSS color matching the icon tint — drives the pending ripple color. */
    const KIND_ICON_COLOR: Record<GroupKind, string> = {
        "trusted-publishing": "var(--success)",
        publish: "var(--brand)",
        mixed: "var(--muted-foreground)",
    };

    const MEMBER_STATUS_DOT: Record<EventStatus, string> = {
        pending: "bg-brand",
        success: "bg-success",
        failed: "bg-destructive",
        expired: "bg-warning",
        "action-required": "bg-warning",
        rejected: "bg-muted-foreground/40",
    };

    const members = $derived(group.events);
    const memberCount = $derived(members.length);
    const aggregatedStatus = $derived(aggregateGroupStatus(members));
    const hasPending = $derived(members.some((e) => e.status === "pending"));
    const KindIcon = $derived(KIND_ICON[group.kind]);
    const statusVariant = $derived(STATUS_VARIANTS[aggregatedStatus]);
    const statusLabel = $derived(
        aggregatedStatus === "action-required"
            ? $_("eventCard.status.actionRequired")
            : $_(`eventCard.status.${aggregatedStatus}`),
    );
    const resolvedCount = $derived(
        members.filter((e) => e.status !== "pending").length,
    );
    const hasDefaultForm = $derived(
        surface === "pending" &&
            hasPending &&
            group.kind === "trusted-publishing",
    );
    /** The group's shared default trusted-publishing config (single source of
     *  truth lives in the daemon; editing the default form updates ONLY this —
     *  no fan-out into member payloads). The form seeds from this and sends
     *  `updateConfigureTrustGroupDraft(groupId, …)`. */
    const groupDefaultConfig = $derived($daemon.groupTrustDefaults[group.id]);
    /** Members that can be retried (failed or rejected). Excludes success —
     *  that's a separate "reset" affordance — and pending (still in flight). */
    const retryableMembers = $derived(
        members.filter((e) => e.status === "failed" || e.status === "rejected"),
    );
    /** Members that succeeded and can be re-run ("reset" back to pending). */
    const succeededMembers = $derived(
        members.filter((e) => e.status === "success"),
    );
    const canRetry = $derived(retryableMembers.length > 0);
    const canReset = $derived(succeededMembers.length > 0);

    let groupDraftValid = $state(false);
    let batchRunning = $state(false);

    // Events accordion state — capture initial once so config changes don't
    // re-fold. The Form is always-expanded (no accordion). Pending surface
    // opens Events (user is about to confirm); history collapses (reference).
    let eventsOpen = $state(untrack(() => surface === "pending"));

    // Per-member inherit/custom mode. The single source of truth is the
    // daemon's explicit `groupInheritMembers` flag (Chapter 6.2.5) — NOT a
    // front-end-only map (which used to reset on refresh) and NOT inferred from
    // whether a member's config is empty. `modeFor` reads the daemon truth;
    // `setMode` flips it via an RPC and the daemon broadcasts the change.
    function modeFor(eventId: string): "inherit" | "custom" {
        const e = members.find((m) => m.id === eventId);
        if (!e) return "inherit";
        return isMemberInheriting(e, $daemon.groupInheritMembers)
            ? "inherit"
            : "custom";
    }
    function setMode(eventId: string, mode: "inherit" | "custom"): void {
        actions.setMemberInherit(eventId, mode === "inherit");
    }

    // Which member's EventDetailDialog is open (at most one).
    let detailEvent = $state<PubEvent | null>(null);
    const detailMode = $derived(
        detailEvent ? modeFor(detailEvent.id) === "inherit" : false,
    );

    function confirmAll(): void {
        if (batchRunning) return;
        batchRunning = true;
        try {
            for (const e of members)
                if (e.status === "pending") actions.confirm(e.id);
        } finally {
            batchRunning = false;
        }
    }
    function rejectAll(): void {
        if (batchRunning) return;
        batchRunning = true;
        try {
            for (const e of members)
                if (e.status === "pending") actions.reject(e.id);
        } finally {
            batchRunning = false;
        }
    }

    /** Re-create a pending event for `member` with the same payload + same
     *  groupId, so the new event folds back into this group in the Events Hub.
     *  Mirrors EventCard.retry() but parameterized over a single member. */
    function recreateMember(member: PubEvent): void {
        const payload = member.payload;
        if (!payload) return;
        actions.createEvent(payload.kind, payload.data, member.groupId);
    }
    /** Retry every failed/rejected member in this group — full fan-out, no
     *  skipping. Each member is recreated as a fresh pending event sharing the
     *  group's groupId. */
    function retryAll(): void {
        if (batchRunning) return;
        batchRunning = true;
        try {
            for (const e of retryableMembers) recreateMember(e);
        } finally {
            batchRunning = false;
        }
    }
    /** Reset every succeeded member — re-run the same operation by recreating
     *  each as a fresh pending event (e.g. re-configure trust, re-publish). */
    function resetAll(): void {
        if (batchRunning) return;
        batchRunning = true;
        try {
            for (const e of succeededMembers) recreateMember(e);
        } finally {
            batchRunning = false;
        }
    }

    const groupTitle = $derived.by(() => {
        const count = $_("groupEvent.packageCount", {
            values: { count: memberCount },
        });
        switch (group.kind) {
            case "trusted-publishing":
                return $_("groupEvent.kindTrustedPublishing", {
                    values: { count },
                });
            case "publish":
                return $_("groupEvent.kindPublish", { values: { count } });
            default:
                return $_("groupEvent.kindMixed", { values: { count } });
        }
    });

    /** Display name for a member row. */
    function memberName(member: PubEvent): string {
        const payload = member.payload;
        if (payload?.kind === "publish") return payload.data.target.name;
        if (payload?.kind === "configure-trust")
            return payload.data.target.name;
        if (payload?.kind === "create-placeholder") return payload.data.name;
        if (payload?.kind === "unpublish") return payload.data.name;
        return member.kind;
    }

    /** Secondary metadata for a member row (version, repo, or trust summary).
     *  For configure-trust members the summary resolves through inheritance:
     *  an inherit member shows the group's default config summary. */
    function memberMeta(member: PubEvent): string {
        const payload = member.payload;
        if (payload?.kind === "publish")
            return `@${payload.data.target.version}`;
        if (payload?.kind === "unpublish") return `@${payload.data.version}`;
        if (payload?.kind === "configure-trust") {
            const ctx = payload.data;
            if (ctx.target.repository) return ctx.target.repository;
            const resolved = resolveTrustedPublishingConfig(
                member,
                $daemon.groupTrustDefaults,
                $daemon.groupInheritMembers,
            );
            if (resolved) return trustedPublisherSummary(resolved);
        }
        return "";
    }

    /** Collapsed summary for the Packages accordion. For trusted-publishing
     *  groups with pending members, shows "N inherit · N custom" (the modes
     *  that actually matter when deciding whether to edit the default form vs
     *  per-member overrides). For other groups, falls back to a plain count. */
    const eventsSummary = $derived.by(() => {
        const showModes =
            group.kind === "trusted-publishing" &&
            surface === "pending" &&
            hasPending;
        if (!showModes) return "";
        let inherit = 0;
        let custom = 0;
        for (const m of members) {
            if (modeFor(m.id) === "custom") custom++;
            else inherit++;
        }
        return $_("groupEvent.modeSummary", { values: { inherit, custom } });
    });

    /** Time of the newest member — same signal EventCard shows in its 2nd row. */
    const timeLabel = $derived(
        new Date(group.latest.createdAt).toLocaleTimeString(),
    );
    /** Resolved = no pending members (drives autoClose countdown visibility). */
    const isResolved = $derived(!hasPending);
</script>

<Card
    class="transition-shadow {aggregatedStatus === 'pending'
        ? 'ring-2 ring-brand/30 shadow-md'
        : ''}"
>
    <CardHeader class="flex-row items-center justify-between gap-3 pb-3">
        <div class="flex min-w-0 items-center gap-2.5">
            <EventIconBadge
                icon={KindIcon}
                tileClass={KIND_ICON_CLASS[group.kind]}
                iconColor={KIND_ICON_COLOR[group.kind]}
                status={aggregatedStatus}
            />
            <div class="min-w-0">
                <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-semibold"
                        >{groupTitle}</span
                    >
                    <Badge
                        variant={statusVariant}
                        class="h-5 shrink-0 capitalize"
                    >
                        {#if hasPending}<IconClock class="mr-1 h-3 w-3" />{/if}
                        {statusLabel}
                    </Badge>
                </div>
                <div
                    class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                    <IconClock class="h-3 w-3" />
                    {timeLabel}
                </div>
            </div>
        </div>
    </CardHeader>

    <CardContent class="space-y-3">
        <!-- Form: the default trust config that fans out to inherit-mode members. -->
        {#if hasDefaultForm}
            <!--
                The default form edits the group's SHARED config (`groupDefaultConfig`),
                not any single member's. `eventId` is a placeholder — for the group
                path the form sends `updateConfigureTrustGroupDraft(groupId, …)`,
                which the daemon stores once and broadcasts as a single
                `group-trust-draft` frame (no per-member echo). `group.latest` is a
                fine representative for the placeholder + repository hint.
            -->
            <TrustFormCard
                eventId={group.latest.id}
                groupId={group.id}
                config={groupDefaultConfig}
                repositoryHint={group.latest.payload?.kind === "configure-trust"
                    ? (group.latest.payload.data.target.repository ?? "")
                    : ""}
                bind:valid={groupDraftValid}
            />
        {:else if surface === "pending" && hasPending && group.kind !== "trusted-publishing"}
            <div
                class="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground"
            >
                {$_("groupEvent.noDefaultForm")}
            </div>
        {/if}

        <!-- Packages: collapsible accordion of one-line member rows. Each row
		     opens an EventDetailDialog for that member's full editing surface. -->
        <div class="rounded-md border border-border">
            <button
                type="button"
                class="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                onclick={() => (eventsOpen = !eventsOpen)}
                aria-expanded={eventsOpen}
            >
                <IconChevronRight
                    class="h-3 w-3 shrink-0 transition-transform {eventsOpen
                        ? 'rotate-90'
                        : ''}"
                />
                <IconLayers class="h-3 w-3 shrink-0" />
                <span class="shrink-0">{$_("groupEvent.packages")}</span>
                <span class="ml-1 shrink-0 text-muted-foreground/70"
                    >· {resolvedCount}/{memberCount}</span
                >
                {#if !eventsOpen && eventsSummary}
                    <span
                        class="ml-auto min-w-0 shrink-0 pl-2 text-right text-muted-foreground/70"
                    >
                        {eventsSummary}
                    </span>
                {/if}
            </button>
            {#if eventsOpen}
                <ul
                    class="max-h-60 space-y-1 overflow-y-auto border-t border-border p-2"
                >
                    {#each members as member, i (member.id)}
                        <li
                            animate:flip={flipParams}
                            in:fade|global={enterParams(i)}
                            out:fade={leaveParams}
                        >
                            <button
                                type="button"
                                class="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/40"
                                onclick={() => (detailEvent = member)}
                            >
                                <span
                                    class="h-1.5 w-1.5 shrink-0 rounded-full {MEMBER_STATUS_DOT[
                                        member.status
                                    ]}"
                                ></span>
                                <span
                                    class="min-w-0 flex-1 truncate font-mono text-foreground"
                                    >{memberName(member)}</span
                                >
                                {#if memberMeta(member)}
                                    <span
                                        class="min-w-0 shrink-0 max-w-[40%] truncate text-muted-foreground/70"
                                        >{memberMeta(member)}</span
                                    >
                                {/if}
                                {#if group.kind === "trusted-publishing" && surface === "pending" && hasPending}
                                    <span
                                        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium {modeFor(
                                            member.id,
                                        ) === 'inherit'
                                            ? 'bg-brand/10 text-brand'
                                            : 'bg-muted text-muted-foreground'}"
                                    >
                                        {modeFor(member.id) === "inherit"
                                            ? $_("groupEvent.inheritDefault")
                                            : $_("groupEvent.customize")}
                                    </span>
                                {/if}
                                <IconChevronRight
                                    class="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
                                />
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>

        <!-- Actions: confirm/reject (pending surface) + retry/reset (resolved).
		     Each row only renders when it has at least one eligible member. -->
        {#if (surface === "pending" && hasPending) || canRetry || canReset || (isResolved && autoClose)}
            <div class="pt-1">
                <ButtonGroup>
                    {#if surface === "pending" && hasPending}
                        <Button
                            variant="brand"
                            size="sm"
                            class="flex-1"
                            disabled={batchRunning ||
                                (group.kind === "trusted-publishing" &&
                                    !groupDraftValid)}
                            onclick={confirmAll}
                        >
                            <IconCheck class="h-3.5 w-3.5" />
                            {$_("groupEvent.confirmAll")}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            class="flex-1"
                            disabled={batchRunning}
                            onclick={rejectAll}
                        >
                            <IconX class="h-3.5 w-3.5" />
                            {$_("groupEvent.rejectAll")}
                        </Button>
                    {/if}
                    {#if canRetry}
                        <Button
                            variant="outline"
                            size="sm"
                            class="flex-1"
                            disabled={batchRunning}
                            onclick={retryAll}
                        >
                            <IconRotateCw class="h-3.5 w-3.5" />
                            {$_("groupEvent.retryAll")}
                            <span class="ml-1 text-[10px] opacity-70"
                                >({retryableMembers.length})</span
                            >
                        </Button>
                    {/if}
                    {#if canReset}
                        <Button
                            variant="outline"
                            size="sm"
                            class="flex-1"
                            disabled={batchRunning}
                            onclick={resetAll}
                        >
                            <IconReset class="h-3.5 w-3.5" />
                            {$_("groupEvent.resetAll")}
                            <span class="ml-1 text-[10px] opacity-70"
                                >({succeededMembers.length})</span
                            >
                        </Button>
                    {/if}
                    {#if isResolved && autoClose}
                        <ButtonGroupSeparator />
                        <AutoCloseBar
                            seconds={10}
                            onclose={() => onAutoClose?.()}
                        />
                    {/if}
                </ButtonGroup>
            </div>
        {/if}
    </CardContent>
</Card>

<EventDetailDialog
    bind:open={
        () => !!detailEvent,
        (v) => {
            if (!v) detailEvent = null;
        }
    }
    event={detailEvent}
    inheritMode={detailMode}
    onToggleInherit={(eventId: string, mode: "inherit" | "custom") =>
        setMode(eventId, mode)}
/>
