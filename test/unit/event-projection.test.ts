/**
 * Feature: WebUI event profile projection
 *
 * Scenario: Given profile-isolated Events, when the active profile changes,
 * then only same-profile events plus pending override cards are visible.
 */
import { describe, expect, it } from "vite-plus/test";
import type { PubEvent } from "../../webui/src/lib/types.js";
import { filterVisibleEvents } from "../../webui/src/lib/event-projection.js";

interface EventFixtureOptions {
  profileOverride?: PubEvent["profileOverride"];
}

function event(
  id: string,
  profile: string,
  status: PubEvent["status"],
  options: EventFixtureOptions = {},
): PubEvent {
  const evt: PubEvent = {
    id,
    kind: "publish",
    status,
    profile,
    createdAt: Number(id),
  };
  if (options.profileOverride !== undefined) evt.profileOverride = options.profileOverride;
  return evt;
}

describe("Feature: WebUI event profile projection", () => {
  it("Scenario: Given mixed-profile history, When projecting for a profile, Then sibling profile history is hidden", () => {
    const events = [
      event("1", "alice", "success"),
      event("2", "work", "success"),
      event("3", "alice", "failed"),
    ];

    expect(filterVisibleEvents(events, "alice").map((item) => item.id)).toEqual(["3", "1"]);
  });

  it("Scenario: Given a pending context override, When projecting for another profile, Then the override card remains visible", () => {
    const events = [
      event("1", "alice", "success"),
      event("2", "work", "pending", { profileOverride: "work" }),
      event("3", "work", "success", { profileOverride: "work" }),
    ];

    expect(filterVisibleEvents(events, "alice").map((item) => item.id)).toEqual(["2", "1"]);
  });
});
