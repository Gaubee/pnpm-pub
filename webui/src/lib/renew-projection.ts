import { get } from "svelte/store";
import { _ } from "svelte-i18n";

export type RenewReason = "expired" | "action-required" | "direct";

export interface RenewProjection {
  heading: string;
  intro: string;
  documentTitle: string;
  submitLabel: string;
  busyLabel: string;
  defaultError: string;
}

export function toRenewReason(value: string | null): RenewReason {
  if (value === "expired" || value === "action-required") return value;
  return "direct";
}

export function getRenewProjection(reason: RenewReason): RenewProjection {
  const t = get(_);
  if (reason === "expired") {
    return {
      heading: t("renew.expiredHeading"),
      intro: t("renew.expiredIntro"),
      documentTitle: t("renew.expiredTitle"),
      submitLabel: t("renew.expiredSubmit"),
      busyLabel: t("renew.expiredBusy"),
      defaultError: t("renew.expiredError"),
    };
  }
  return {
    heading: t("renew.credentialHeading"),
    intro: t("renew.credentialIntro"),
    documentTitle: t("renew.credentialTitle"),
    submitLabel: t("renew.credentialSubmit"),
    busyLabel: t("renew.credentialBusy"),
    defaultError: t("renew.credentialError"),
  };
}
