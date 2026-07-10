import { describe, expect, it } from "vite-plus/test";
import { materializeEventGroup } from "../../webui/src/lib/group-event.js";
import type { PubEvent } from "../../webui/src/lib/types.js";

function removalEvent(id: string, root?: string): PubEvent {
  return {
    id,
    kind: "configure-trust",
    status: "pending",
    profile: "alice",
    createdAt: Number(id),
    groupId: "group",
    payload: {
      kind: "configure-trust",
      data: {
        action: "remove",
        target: { name: `@scope/pkg-${id}`, path: `/workspace/packages/${id}` },
        ...(root ? { root } : {}),
      },
    },
  };
}

describe("Feature: GroupEvent root projection", () => {
  it("Scenario: Given removal members with one shared root, When materialized, Then the group exposes that root", () => {
    const group = materializeEventGroup({
      id: "group",
      events: [removalEvent("2", "/workspace"), removalEvent("1", "/workspace")],
    });

    expect(group.root).toBe("/workspace");
  });

  it("Scenario: Given conflicting member roots, When materialized, Then no arbitrary root is projected", () => {
    const group = materializeEventGroup({
      id: "group",
      events: [removalEvent("2", "/workspace-a"), removalEvent("1", "/workspace-b")],
    });

    expect(group.root).toBeUndefined();
  });
});
