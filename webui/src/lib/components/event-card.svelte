<script lang="ts">
    /**
     * EventCard — the unit of the Events Hub (Chapter 6.2).
     *
     * This is now an ASSEMBLER: it owns every piece of business logic (derived
     * state, effects, action callbacks) and composes three shell-agnostic
     * presentational children into one of two surfaces:
     *
     *   surface='card'   (default, list use)   → wraps the three segments in a
     *                                            semantic <Card>/<CardHeader>/
     *                                            <CardContent>/<CardFooter>.
     *   surface='dialog' (detail dialog use)   → emits the three segments bare,
     *                                            so an EventDetailDialog can lay
     *                                            them out as DialogHeader /
     *                                            scrollable body / footer rows
     *                                            with NO second layer of card.
     *
     * The children (EventCardHeader/Body/Footer) hold NO cross-segment state;
     * everything flows down via props/callbacks. Local-only UI state
     * (showFiles / logExpanded / advancedOpen) lives inside the segment that
     * owns it. The only state that stays HERE is what crosses segment
     * boundaries: trustedPublishingDraftValid (Body↔Footer confirm gating),
     * confirming/rejecting (Footer action + Body form-disabled), confirmUnpublish
     * (Footer-internal, kept inside Footer).
     *
     * Composition slots (snippet props) are accepted from the host and forwarded
     * to the Header so a Dialog can fuse its title/toggle into the card chrome:
     *   - titleLabel    : wraps the visible title (e.g. in <DialogTitle>).
     *   - headerTrailing: extra trailing content in the header action row.
     */
    import type {
        EventStatus,
        PubEvent,
        TrustedPublisherCreateConfig,
    } from "$lib/types.js";
    import {
        type BadgeVariant,
    } from "$lib/components/ui/badge/index.js";
    import {
        Card,
        CardContent,
        CardFooter,
        CardHeader,
    } from "$lib/components/ui/card/index.js";
    import type { Snippet } from "svelte";
    import type { RepoInfo } from "$lib/components/repo-info-types.js";
    import { actions, daemon } from "$lib/store.js";
    import { isMemberInheriting } from "$lib/trusted-publishing.js";
    import EventCardHeader from "$lib/components/event-card-header.svelte";
    import EventCardBody from "$lib/components/event-card-body.svelte";
    import EventCardFooter from "$lib/components/event-card-footer.svelte";
    import IconPublish from "@lucide/svelte/icons/upload";
    import IconTrustedPublishing from "@lucide/svelte/icons/shield-check";
    import IconLayers from "@lucide/svelte/icons/layers";
    import IconPlaceholder from "@lucide/svelte/icons/package";
    import IconRefresh from "@lucide/svelte/icons/refresh-cw";
    import IconTrash from "@lucide/svelte/icons/trash-2";
    import { _ } from "svelte-i18n";

    let {
        event,
        /** Log display mode: 'full' (wrapped, scrollable both axes) or 'compact'
         *  (single-line truncated; click toggles a horizontally-scrollable block). */
        variant = "full",
        /**
         * When true (only meaningful with variant='full'), a freshly-resolved card
         * shows an AutoCloseBar countdown at the inline-end of the card footer.
         * `onAutoClose` is invoked when the countdown elapses or the user closes.
         */
        autoClose = false,
        onAutoClose,
        /** Read-only view: for configure-trust add events, render a static
         *  summary of the current config instead of an editable form. The
         *  parent (e.g. EventDetailDialog) owns the read-only/editable switch;
         *  EventCard itself never renders the toggle UI. */
        readOnly = false,
        /** Override the groupId forwarded to the trust draft form. Defaults to
         *  `event.groupId`. A parent that wants this member to edit
         *  independently (custom mode) passes `undefined` so the form's edits do
         *  NOT fan out via updateConfigureTrustGroupDraft. */
        trustGroupId,
        /** Shell to fuse into. 'card' wraps the segments in <Card>; 'dialog'
         *  emits them bare so an EventDetailDialog can lay them out directly. */
        surface = "card",
        /** Composition slots forwarded to EventCardHeader — see component doc. */
        titleLabel,
        headerTrailing,
        /** Extra classes for the header row, forwarded to EventCardHeader. The
         *  dialog host uses this to reserve space (e.g. `pr-9`) so the header
         *  content clears the absolutely positioned close button baked into
         *  DialogContent. Card mode passes nothing. */
        headerClass,
        /** Overrides the pending footer's LEFT cluster (default: confirm/reject).
         *  When supplied, this snippet replaces the confirm/reject ButtonGroup
         *  in-place; the RIGHT open-actions cluster is untouched. Used by
         *  EventDetailDialog to render a discard/close row for trust members.
         *  Only takes effect while `useFooterLeftCluster` is true. */
        footerLeftCluster,
        /** Gate for `footerLeftCluster`. The host passes the snippet once and
         *  flips this per-event so the template needs no forward reference. */
        useFooterLeftCluster = false,
        /** Stage trust-form edits locally instead of shipping to the daemon on
         *  every keystroke. The dialog host reads the staged config back via
         *  the footer's leftCluster snippet and submits it on Save. Ignored in
         *  card mode (GroupEventCard's default form stays edit-live). */
        deferSubmit = false,
        /**
         * Dialog-mode only. The host supplies a children snippet that receives
         * `{ header, body, footer, hasFooter }` and lays each into its
         * DialogHeader / scrollable body / footer grid row. `hasFooter` lets
         * the host omit the footer row (and its divider) entirely when the
         * card would render no footer actions. The trust form's dirty/reset
         * signals flow through `footerLeftCluster` (a parameterized snippet),
         * not here. Ignored in card mode.
         */
        children,
    }: {
        event: PubEvent;
        variant?: "full" | "compact";
        autoClose?: boolean;
        onAutoClose?: () => void;
        readOnly?: boolean;
        trustGroupId?: string;
        surface?: "card" | "dialog";
        titleLabel?: Snippet<[{ child: Snippet }]>;
        headerTrailing?: Snippet;
        headerClass?: string;
        footerLeftCluster?: Snippet<[{ draftDirty: boolean; resetDraft: () => void; stagedConfig: TrustedPublisherCreateConfig | null }]>;
        useFooterLeftCluster?: boolean;
        deferSubmit?: boolean;
        children?: Snippet<
            [
                {
                    header: Snippet;
                    body: Snippet;
                    footer: Snippet;
                    hasFooter: boolean;
                },
            ]
        >;
    } = $props();

    const STATUS_VARIANTS = {
        pending: "brand",
        success: "success",
        failed: "destructive",
        expired: "warning",
        "action-required": "warning",
        rejected: "secondary",
        // trusted-publishing pre-flight: skipped = neutral success tint.
        // (conflict is NOT a status — only a transient webui display label.)
        skipped: "success",
    } satisfies Record<EventStatus, NonNullable<BadgeVariant>>;

    const iconFor = (kind: PubEvent["kind"]) =>
        ({
            publish: IconPublish,
            "configure-trust": IconTrustedPublishing,
            "recursive-publish": IconLayers,
            "create-placeholder": IconPlaceholder,
            "refresh-token": IconRefresh,
            unpublish: IconTrash,
            import: IconRefresh,
            export: IconRefresh,
        })[kind] ?? IconPublish;

    // Action-type accent color — drives ONLY the top-left icon tint, derived
    // from the event KIND. publish → brand (blue), unpublish → destructive
    // (red), configure-trust → success (green), everything else → neutral.
    // The card border uses the STATUS color (see below), so the two signals
    // stay independent.
    const kindAccent = $derived.by(() => {
        switch (event.kind) {
            case "publish":
            case "recursive-publish":
                return "brand";
            case "unpublish":
                return "destructive";
            case "configure-trust":
                return "success";
            default:
                return "";
        }
    });
    const kindIconClass = $derived(
        kindAccent === "brand"
            ? "bg-brand/10 text-brand border-brand/38"
            : kindAccent === "success"
              ? "bg-success/10 text-success border-success/38"
              : kindAccent === "destructive"
                ? "bg-destructive/10 text-destructive border-destructive/38"
                : "bg-accent text-muted-foreground  border-muted/38",
    );
    /** CSS color matching the icon tint — drives the pending ripple color. */
    const kindIconColor = $derived(
        kindAccent === "brand"
            ? "var(--brand)"
            : kindAccent === "success"
              ? "var(--success)"
              : kindAccent === "destructive"
                ? "var(--destructive)"
                : "var(--muted-foreground)",
    );
    // Card border / ring tint — driven by the event STATUS (not the kind).
    // pending → brand, success → green, failed → red, rejected → muted,
    // expired/action-required → warning. Static class strings (Tailwind can't
    // compose dynamic fragments).
    const statusRing = $derived.by(() => {
        switch (event.status) {
            case "pending":
                return "ring-brand/40";
            case "success":
                return "ring-success/40";
            case "failed":
                return "ring-destructive/40";
            case "expired":
            case "action-required":
                return "ring-warning/40";
            case "skipped":
                return "ring-success/30";
            default:
                return "ring-border"; // rejected
        }
    });
    const statusBorder = $derived.by(() => {
        switch (event.status) {
            case "pending":
                return "border-brand/30";
            case "success":
                return "border-success/30";
            case "failed":
                return "border-destructive/30";
            case "expired":
            case "action-required":
                return "border-warning/30";
            case "skipped":
                return "border-success/20";
            default:
                return "border-border"; // rejected
        }
    });

    const IconCmp = $derived(iconFor(event.kind));

    const statusVariant = $derived(STATUS_VARIANTS[event.status]);
    const statusLabel = $derived(
        event.status === "action-required"
            ? $_("eventCard.status.actionRequired")
            : $_(`eventCard.status.${event.status}`),
    );

    const isPending = $derived(event.status === "pending");
    const isExpired = $derived(event.status === "expired");
    const needsAction = $derived(event.status === "action-required");

    // Context-override: the event may be tied to a different profile than the
    // sidebar's current selection (Chapter 5.4.5 / 6.2.2).
    const overrideActive = $derived(
        !!event.profileOverride &&
            event.profileOverride !== $daemon.defaultProfile,
    );
    const effectiveProfile = $derived(event.profileOverride ?? event.profile);

    // Publish carries a target; placeholder projects its generated v0.0.0 target for display.
    function makePlaceholderTarget(name: string) {
        return {
            name,
            version: "0.0.0",
            previousVersion: undefined,
            description: $_("eventCard.generatedPlaceholder"),
            path: $_("eventCard.generated"),
        };
    }

    const publishTarget = $derived(
        event.payload?.kind === "publish"
            ? event.payload.data
            : event.payload?.kind === "create-placeholder"
              ? { target: makePlaceholderTarget(event.payload.data.name) }
              : null,
    );
    const configureTrustCtx = $derived(
        event.payload?.kind === "configure-trust" ? event.payload.data : null,
    );
    const unpublishCtx = $derived(
        event.payload?.kind === "unpublish" ? event.payload.data : null,
    );
    const recursiveCtx = $derived(
        event.payload?.kind === "recursive-publish" ? event.payload.data : null,
    );

    const timeLabel = $derived(new Date(event.createdAt).toLocaleTimeString());

    // Tarball file-tree preview — collapsed by default. (Body-local state now.)
    // Publish actions (retry / unpublish) — only for publish events.
    const isPublish = $derived(event.payload?.kind === "publish");
    const publishData = $derived(
        event.payload?.kind === "publish" ? event.payload.data : null,
    );
    const tarballSummary = $derived(event.tarballSummary ?? null);

    // --- Header title + version ---
    const titleName = $derived(
        recursiveCtx
            ? $_("eventCard.recursivePublish")
            : publishTarget
              ? publishTarget.target.name
              : configureTrustCtx
                ? configureTrustCtx.target.name
                : unpublishCtx
                  ? unpublishCtx.name
                  : event.kind,
    );
    const versionLabel = $derived(
        publishTarget
            ? publishTarget.target.version
            : unpublishCtx
              ? unpublishCtx.version
              : "",
    );
    const rejectedWithResult = $derived(
        event.status === "rejected" && !!event.result,
    );

    // --- Right-corner actions (repo link / open folder / npm link) ---
    // Every card renders a unified ButtonGroup; which actions appear depends on
    // the event kind and the data it carries.
    let repoInfo = $state<RepoInfo | null>(null);
    // The raw repository string to resolve, drawn from whichever event kind
    // carries one (publish.target.repository, trusted publishing target, or any
    // recursive-publish target's repository).
    const repoRaw = $derived(
        publishData?.target.repository ??
            configureTrustCtx?.target.repository ??
            recursiveCtx?.targets.find((t) => t.repository)?.repository ??
            "",
    );
    $effect(() => {
        if (!repoRaw) {
            repoInfo = null;
            return;
        }
        // Fire-and-forget; the store memoizes so re-renders are cheap.
        void actions.repoInfo(repoRaw).then((info) => {
            repoInfo = info;
        });
    });
    // The local package directory (for "open folder"). Publish → source path;
    // trusted publishing → its path; recursive-publish → workspace root. Unpublish /
    // placeholder have no local path.
    const sourcePath = $derived(
        publishData?.source.path ??
            recursiveCtx?.source.path ??
            configureTrustCtx?.target.path ??
            "",
    );
    // The npm registry page link. For publish, derived from target name/version.
    // For unpublish, from its name/version. For create-placeholder, name only.
    const packageName = $derived(
        unpublishCtx?.name ??
            publishTarget?.target.name ??
            configureTrustCtx?.target.name ??
            (event.payload?.kind === "create-placeholder"
                ? event.payload.data.name
                : ""),
    );
    const packageVersion = $derived(
        unpublishCtx?.version ?? publishTarget?.target.version ?? "",
    );
    const npmUrl = $derived.by(() => {
        if (!packageName) return "";
        // Only link to the specific published version once the publish actually
        // succeeded; while pending (or failed/expired/rejected) that version
        // isn't on the registry yet, and placeholder/unpublish events never have
        // a real published version — so link to the package landing page instead.
        if (packageVersion && isPublish && event.status === "success") {
            return `https://www.npmjs.com/package/${packageName}/v/${packageVersion}`;
        }
        return `https://www.npmjs.com/package/${packageName}`;
    });
    // Whether the right-corner area of the header has anything to show. The
    // "click to open" actions (repo / folder / npm) now live in the footer, so
    // only the cross-profile override chip remains up here.
    const hasCornerActions = $derived(overrideActive);
    const isRetryableStatus = $derived(
        event.status === "failed" ||
            event.status === "expired" ||
            event.status === "rejected",
    );
    const isConfigureTrust = $derived(!!configureTrustCtx);
    const isRetryable = $derived(
        (isPublish ||
            event.payload?.kind === "unpublish" ||
            event.payload?.kind === "recursive-publish" ||
            isConfigureTrust) &&
            isRetryableStatus,
    );
    /** Whether the inline Retry button renders (publish + recursive-publish;
     *  unpublish retry goes through the ConfirmAction two-step instead). */
    const hasRetryButton = $derived(
        isRetryableStatus &&
            (isPublish ||
                event.payload?.kind === "recursive-publish" ||
                isConfigureTrust),
    );
    const isUnpublishable = $derived(isPublish && event.status === "success");
    // trustedPublishingDraftValid crosses Body↔Footer (gates the confirm button);
    // confirming/rejecting cross Footer(action)↔Body(form disabled). These stay
    // here in the assembler. confirmUnpublish is footer-internal.
    let trustedPublishingDraftValid = $state(false);
    // Whether the trust form carries unsaved edits (vs its seed). Surfaced to a
    // dialog host via the children snippet so its footer can show "Discard".
    let trustedPublishingDraftDirty = $state(false);
    // Local-staged trust config (deferSubmit mode). Surfaced to the dialog's
    // footer leftCluster so Save can submit it; null when invalid/unchanged.
    let trustedPublishingStagedConfig = $state<TrustedPublisherCreateConfig | null>(null);
    // Ref to the EventCardBody so its exported resetToSeed can be re-exposed to
    // the dialog host. Null outside dialog mode / before mount.
    let bodyRef: { resetToSeed: () => void } | null = $state(null);
    let confirming = $state(false);
    let rejecting = $state(false);
    $effect(() => {
        // Re-run whenever status changes; clear once it's no longer pending.
        if (event.status !== "pending") {
            confirming = false;
            rejecting = false;
        }
    });

    function doConfirm(): void {
        if (!canConfirm || confirming) return;
        confirming = true;
        actions.confirm(event.id);
    }
    function doReject(): void {
        if (rejecting) return;
        rejecting = true;
        actions.reject(event.id);
    }

    function retry(): void {
        // Re-create the event with the SAME payload. If the original was part
        // of a group, mint a FRESH groupId for the retry — reusing the original
        // would fold the retried event back into the OLD (failed) group,
        // doubling the task list and leaving the original failure visible
        // alongside the new pending retry. A standalone retry stays standalone.
        const retryGroupId = event.groupId ? crypto.randomUUID() : undefined;
        if (publishData) {
            actions.createEvent("publish", publishData, retryGroupId);
        } else if (recursiveCtx) {
            actions.createEvent(
                "recursive-publish",
                recursiveCtx,
                retryGroupId,
            );
        } else if (configureTrustCtx) {
            actions.createEvent(
                "configure-trust",
                configureTrustCtx,
                retryGroupId,
            );
        } else if (unpublishCtx) {
            actions.createEvent("unpublish", unpublishCtx, retryGroupId);
        }
    }

    /** Create a pending unpublish event for this package@version. The user then
     *  confirms/rejects on the new EventCard, exactly like publish. */
    function doUnpublish(): void {
        if (!publishData) return;
        actions.createEvent(
            "unpublish",
            {
                name: publishData.target.name,
                version: publishData.target.version,
            },
            event.groupId,
        );
    }

    // --- Advanced publish options (only for pending publish events) ---
    // The publish `args` are the single source of truth (the daemon re-reads them
    // live at confirm time). We parse them into structured accessors for display,
    // and every control mutation rebuilds the args and ships an `update-event`.

    /** The editable payload's args/branch, read from whichever publish-like
     *  payload is active (single-package `publish` or `recursive-publish`). All
     *  advanced-option deriveds below read from this single source so the panel
     *  works identically for both kinds. */
    const editableArgs = $derived(
        publishData?.args ?? recursiveCtx?.args ?? [],
    );
    const currentBranch = $derived(
        publishData?.branch ?? recursiveCtx?.branch ?? "",
    );

    /** Find `--flag <value>` (or `--flag=value`) in args; returns undefined if absent. */
    function argValue(args: string[], flag: string): string | undefined {
        for (let i = 0; i < args.length; i++) {
            const a = args[i]!;
            if (a === flag) {
                const next = args[i + 1];
                if (next && !next.startsWith("-")) return next;
            }
            if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
        }
        return undefined;
    }
    const accessArg = $derived(
        argValue(editableArgs, "--access") === "restricted"
            ? "restricted"
            : "public",
    );
    const tagArg = $derived(argValue(editableArgs, "--tag") ?? "");
    /** A boolean flag is "on" when present as `--flag` and "off" only when an
     *  explicit `--no-flag` is present. Absent ⇒ default (per-option). */
    function hasFlag(args: string[], flag: string): boolean {
        return args.includes(flag);
    }

    // Whether `--access` is meaningful: single-package ⇒ scoped check; recursive
    // ⇒ any scoped target (pnpm publish -r applies one --access to the run, and
    // non-scoped targets ignore it at the registry, so "any scoped" is the
    // pragmatic gate).
    const isScopedPkg = $derived.by(() => {
        if (publishData) return publishData.target.name.startsWith("@");
        if (recursiveCtx)
            return recursiveCtx.targets.some((t) => t.name.startsWith("@"));
        return false;
    });
    const ignoreScriptsOn = $derived(hasFlag(editableArgs, "--ignore-scripts"));
    // No-git-checks defaults ON: if the args carry no explicit --git-checks,
    // we treat it as opted-out (the common case for feature-branch publishes).
    const noGitChecksOn = $derived(
        hasFlag(editableArgs, "--git-checks") ? false : true,
    );
    const publishBranchOn = $derived(
        argValue(editableArgs, "--publish-branch") !== undefined,
    );
    const publishBranchValue = $derived(
        argValue(editableArgs, "--publish-branch") ?? "",
    );

    // publish-branch mismatch gate: blocks the Confirm button client-side.
    const branchMismatch = $derived(
        publishBranchOn &&
            !!currentBranch &&
            publishBranchValue !== currentBranch,
    );
    const branchNoCurrent = $derived(publishBranchOn && !currentBranch);
    /** For a configure-trust member of a group, "ready" depends on inheritance:
     *  - inherit member: ready when the GROUP DEFAULT config exists (the member
     *    itself carries no config; it resolves to the group default at confirm).
     *  - custom member (or standalone): ready when its own config is present
     *    (either carried on the payload, or the inline form's draft is valid).
     *  Without this, an inherit member's confirm button stays disabled even
     *  after the group default form is filled — because the member's own
     *  `configureTrustCtx.config` is empty and no inline form runs for it. */
    const inheritsGroupDefault = $derived(
        !!event.groupId &&
            !!configureTrustCtx &&
            configureTrustCtx.action !== "remove" &&
            isMemberInheriting(event, $daemon.groupInheritMembers),
    );
    const groupDefaultPresent = $derived(
        event.groupId ? !!$daemon.groupTrustDefaults[event.groupId] : false,
    );
    const trustedPublishingReady = $derived(
        !configureTrustCtx ||
            configureTrustCtx.action === "remove" ||
            (inheritsGroupDefault
                ? groupDefaultPresent
                : !!configureTrustCtx.config || trustedPublishingDraftValid),
    );
    const canConfirm = $derived(
        isPending && !branchMismatch && trustedPublishingReady,
    );

    /** Whether the advanced-options panel should render at all. */
    const hasAdvancedOptions = $derived(isPublish || !!recursiveCtx);

    /** Rebuild args from the current structured state + a partial override, then
     *  ship an update-event. Works for both `publish` and `recursive-publish`
     *  (both carry an editable `args` array). */
    function rebuildArgs(overrides?: {
        access?: "public" | "restricted";
        tag?: string;
        ignoreScripts?: boolean;
        noGitChecks?: boolean;
        publishBranchOn?: boolean;
        publishBranch?: string;
    }): void {
        if (!publishData && !recursiveCtx) return;
        const access = overrides?.access ?? accessArg;
        const tag = overrides?.tag !== undefined ? overrides.tag : tagArg;
        const ignoreScripts = overrides?.ignoreScripts ?? ignoreScriptsOn;
        const branchOn = overrides?.publishBranchOn ?? publishBranchOn;
        const branchVal =
            overrides?.publishBranch !== undefined
                ? overrides.publishBranch
                : publishBranchValue;
        const noGitChecks =
            overrides?.noGitChecks ?? (branchOn ? false : noGitChecksOn);

        const args: string[] = ["--access", access];
        if (tag && tag !== "latest") args.push("--tag", tag);
        if (ignoreScripts) args.push("--ignore-scripts");
        // Git checks default ON at the daemon; we emit --no-git-checks to opt out.
        // Enabling publish-branch turns git checks back ON (drops --no-git-checks)
        // and narrows the allowed branch via --publish-branch.
        if (!branchOn && noGitChecks) args.push("--no-git-checks");
        if (branchOn && branchVal) args.push("--publish-branch", branchVal);
        // recursive-publish forwards the -r flag so the rebuilt args stay valid.
        if (
            recursiveCtx &&
            !args.includes("-r") &&
            !args.includes("--recursive")
        )
            args.unshift("-r");
        actions.updateEvent(event.id, args);
    }

    // The Body needs the publish-target description (publish + placeholder).
    const description = $derived(publishTarget?.target.description ?? null);

    // Whether the footer renders anything at all (drives CardFooter visibility
    // in card mode and the footer grid row in dialog mode). The "click to open"
    // actions (repo / folder / npm) now live in the footer, so an event that
    // carries any of them also shows the footer even when otherwise resolved.
    const hasFooter = $derived(
        isPending ||
            isExpired ||
            needsAction ||
            isRetryable ||
            isUnpublishable ||
            (autoClose && variant === "full") ||
            !!repoInfo ||
            !!sourcePath ||
            !!npmUrl,
    );

    // Forwarded open helpers (Header only).
    function onOpenUrl(url: string): void {
        actions.openUrl(url);
    }
    function onOpenPath(path: string): void {
        actions.openPath(path);
    }
</script>

{#if surface === "card"}
    <Card
        class="transition-shadow {isPending
            ? `ring-2 ${statusRing} shadow-md`
            : statusBorder}"
    >
        <CardHeader class="flex-row items-center justify-between gap-3 pb-3">
            <EventCardHeader
                {event}
                iconCmp={IconCmp}
                {kindIconClass}
                {kindIconColor}
                status={event.status}
                {statusVariant}
                {statusLabel}
                {timeLabel}
                titleName={titleName}
                version={versionLabel}
                {rejectedWithResult}
                {hasCornerActions}
                {overrideActive}
                effectiveProfile={effectiveProfile}
                {titleLabel}
                {headerTrailing}
                class={headerClass}
            />
        </CardHeader>
        <CardContent class="space-y-3">
            <EventCardBody
                bind:this={bodyRef}
                {event}
                status={event.status}
                {isPending}
                bind:valid={trustedPublishingDraftValid}
                bind:dirty={trustedPublishingDraftDirty}
                bind:stagedConfig={trustedPublishingStagedConfig}
                {deferSubmit}
                {readOnly}
                {trustGroupId}
                {overrideActive}
                {description}
                {configureTrustCtx}
                {unpublishCtx}
                {recursiveCtx}
                {tarballSummary}
                {confirming}
                {hasAdvancedOptions}
                {accessArg}
                {tagArg}
                {ignoreScriptsOn}
                {noGitChecksOn}
                {publishBranchOn}
                {publishBranchValue}
                {currentBranch}
                {isScopedPkg}
                {branchMismatch}
                {branchNoCurrent}
                onRebuildArgs={rebuildArgs}
            />
            {#if hasFooter}
                <div class="pt-1">
                    <EventCardFooter
                        eventKind={event.kind}
                        status={event.status}
                        {isPending}
                        {isExpired}
                        {needsAction}
                        {isRetryableStatus}
                        {isRetryable}
                        {hasRetryButton}
                        {isUnpublishable}
                        isPublish={isPublish}
                        {configureTrustCtx}
                        {unpublishCtx}
                        {publishData}
                        {canConfirm}
                        {confirming}
                        {rejecting}
                        {autoClose}
                        {variant}
                        {repoInfo}
                        {sourcePath}
                        {npmUrl}
                        onOpenUrl={onOpenUrl}
                        onOpenPath={onOpenPath}
                        onConfirm={doConfirm}
                        onReject={doReject}
                        onRetry={retry}
                        leftCluster={footerLeftCluster}
                        useLeftCluster={useFooterLeftCluster}
                        draftDirty={trustedPublishingDraftDirty}
                        resetDraft={() => bodyRef?.resetToSeed()}
                        stagedConfig={trustedPublishingStagedConfig}
                        onUnpublish={doUnpublish}
                        onAutoClose={onAutoClose}
                    />
                </div>
            {/if}
        </CardContent>
    </Card>
{:else}
    {#snippet headerSegment()}
        <EventCardHeader
            {event}
            iconCmp={IconCmp}
            {kindIconClass}
            {kindIconColor}
            status={event.status}
            {statusVariant}
            {statusLabel}
            {timeLabel}
            titleName={titleName}
            version={versionLabel}
            {rejectedWithResult}
            {hasCornerActions}
            {overrideActive}
            effectiveProfile={effectiveProfile}
            {titleLabel}
            {headerTrailing}
            class={headerClass}
        />
    {/snippet}
    {#snippet bodySegment()}
        <EventCardBody
            bind:this={bodyRef}
            {event}
            status={event.status}
            {isPending}
            bind:valid={trustedPublishingDraftValid}
            bind:dirty={trustedPublishingDraftDirty}
            bind:stagedConfig={trustedPublishingStagedConfig}
            {deferSubmit}
            {readOnly}
            {trustGroupId}
            {overrideActive}
            {description}
            {configureTrustCtx}
            {unpublishCtx}
            {recursiveCtx}
            {tarballSummary}
            {confirming}
            {hasAdvancedOptions}
            {accessArg}
            {tagArg}
            {ignoreScriptsOn}
            {noGitChecksOn}
            {publishBranchOn}
            {publishBranchValue}
            {currentBranch}
            {isScopedPkg}
            {branchMismatch}
            {branchNoCurrent}
            onRebuildArgs={rebuildArgs}
        />
    {/snippet}
    {#snippet footerSegment()}
        {#if hasFooter}
            <EventCardFooter
                eventKind={event.kind}
                status={event.status}
                {isPending}
                {isExpired}
                {needsAction}
                {isRetryableStatus}
                {isRetryable}
                {hasRetryButton}
                {isUnpublishable}
                isPublish={isPublish}
                {configureTrustCtx}
                {unpublishCtx}
                {publishData}
                {canConfirm}
                {confirming}
                {rejecting}
                {autoClose}
                {variant}
                {repoInfo}
                {sourcePath}
                {npmUrl}
                onOpenUrl={onOpenUrl}
                onOpenPath={onOpenPath}
                onConfirm={doConfirm}
                onReject={doReject}
                leftCluster={footerLeftCluster}
                useLeftCluster={useFooterLeftCluster}
                draftDirty={trustedPublishingDraftDirty}
                resetDraft={() => bodyRef?.resetToSeed()}
                stagedConfig={trustedPublishingStagedConfig}
                onRetry={retry}
                onUnpublish={doUnpublish}
                onAutoClose={onAutoClose}
            />
        {/if}
    {/snippet}

    <!--
        Dialog surface: the host (EventDetailDialog) supplies a `children`
        snippet that receives `{ header, body, footer, hasFooter }` and lays
        each into its DialogHeader / scrollable body / footer grid row — with
        NO second <Card> wrapper, so the card chrome fuses into the dialog
        chrome. The trust form's dirty/reset signals flow through
        `footerLeftCluster` (a parameterized named-snippet child), not here.
    -->
    {@render children?.({
        header: headerSegment,
        body: bodySegment,
        footer: footerSegment,
        hasFooter,
    })}
{/if}

