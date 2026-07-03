/**
 * Feature: WebUI WebSocket message decoding
 *
 * Scenario: Given transport data from the daemon, when the WebUI store decodes
 * it, then only proven protocol messages can enter store state.
 */
import { describe, expect, it } from "vite-plus/test";
import { parseWsServerMessage } from "../../webui/src/lib/ws-message.js";

describe("Feature: WebUI WebSocket message decoding", () => {
  it("Scenario: Given a valid profiles frame, When decoding, Then the typed message is returned", () => {
    const message = parseWsServerMessage(
      JSON.stringify({
        type: "profiles",
        default: "alice",
        profiles: [{ username: "alice", registry: "https://registry.npmjs.org/" }],
      }),
    );

    expect(message).toEqual({
      type: "profiles",
      default: "alice",
      profiles: [{ username: "alice", registry: "https://registry.npmjs.org/" }],
    });
  });

  it("Scenario: Given non-string transport data, When decoding, Then the message is rejected", () => {
    expect(parseWsServerMessage(new ArrayBuffer(0))).toBeNull();
  });

  it("Scenario: Given a malformed event frame, When decoding, Then the message is rejected", () => {
    const message = parseWsServerMessage(
      JSON.stringify({
        type: "event",
        event: {
          id: "evt-1",
          kind: "publish",
          status: "pending",
          profile: "alice",
          createdAt: "not-a-number",
        },
      }),
    );

    expect(message).toBeNull();
  });

  it("Scenario: Given a workspace frame with an invalid timestamp, When decoding, Then the message is rejected", () => {
    const message = parseWsServerMessage(
      JSON.stringify({
        type: "workspaces",
        workspaces: [{ path: "/repo", pinned: false, addedAt: -1 }],
      }),
    );

    expect(message).toBeNull();
  });

  it("Scenario: Given an event frame with an invalid resolved timestamp, When decoding, Then the message is rejected", () => {
    const message = parseWsServerMessage(
      JSON.stringify({
        type: "event",
        event: {
          id: "evt-2",
          kind: "publish",
          status: "success",
          profile: "alice",
          createdAt: 1,
          resolvedAt: -1,
        },
      }),
    );

    expect(message).toBeNull();
  });

  it("Scenario: Given a REST backup action projected as an event kind, When decoding, Then the message is rejected", () => {
    const message = parseWsServerMessage(
      JSON.stringify({
        type: "event",
        event: {
          id: "evt-3",
          kind: "export",
          status: "pending",
          profile: "alice",
          createdAt: 1,
        },
      }),
    );

    expect(message).toBeNull();
  });

  it("Scenario: Given a pin frame with a live countdown, When decoding, Then the typed message is returned", () => {
    const message = parseWsServerMessage(
      JSON.stringify({ type: "pin", pinned: false, countdown: 2 }),
    );
    expect(message).toEqual({ type: "pin", pinned: false, countdown: 2 });
  });

  it("Scenario: Given a pin frame with a null countdown (idle), When decoding, Then null is preserved", () => {
    const message = parseWsServerMessage(
      JSON.stringify({ type: "pin", pinned: true, countdown: null }),
    );
    expect(message).toEqual({ type: "pin", pinned: true, countdown: null });
  });

  it("Scenario: Given a pin frame with a negative countdown, When decoding, Then the message is rejected", () => {
    expect(
      parseWsServerMessage(JSON.stringify({ type: "pin", pinned: false, countdown: -1 })),
    ).toBeNull();
  });
});
