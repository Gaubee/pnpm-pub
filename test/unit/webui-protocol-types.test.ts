/**
 * WebUI protocol mirror parity (Chapters 3.2.2 / 5.2).
 */
import { describe, expect, it } from "vite-plus/test";
import type {
  BackupBundle as SharedBackupBundle,
  EventPayloadData as SharedEventPayloadData,
  EventPayload as SharedEventPayload,
  Profile as SharedProfile,
  PubEvent as SharedPubEvent,
  PublishTarget as SharedPublishTarget,
  WorkspaceEntry as SharedWorkspaceEntry,
  WsServerMessage as SharedWsServerMessage,
} from "../../src/shared/index.js";
import type {
  BackupBundle as WebBackupBundle,
  EventPayloadData as WebEventPayloadData,
  EventPayload as WebEventPayload,
  Profile as WebProfile,
  PubEvent as WebPubEvent,
  PublishTarget as WebPublishTarget,
  WorkspaceEntry as WebWorkspaceEntry,
  WsServerMessage as WebWsServerMessage,
} from "../../webui/src/lib/types.js";

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;

type AssertEqual<A, B> = IsEqual<A, B> extends true ? true : never;

const protocolMirrorIsExact: [
  AssertEqual<WebProfile, SharedProfile>,
  AssertEqual<WebWorkspaceEntry, SharedWorkspaceEntry>,
  AssertEqual<WebPublishTarget, SharedPublishTarget>,
  AssertEqual<WebEventPayload, SharedEventPayload>,
  AssertEqual<WebPubEvent, SharedPubEvent>,
  AssertEqual<WebBackupBundle, SharedBackupBundle>,
  AssertEqual<WebEventPayloadData<"publish">, SharedEventPayloadData<"publish">>,
  AssertEqual<WebEventPayloadData<"setup-oidc">, SharedEventPayloadData<"setup-oidc">>,
  AssertEqual<
    WebEventPayloadData<"create-placeholder">,
    SharedEventPayloadData<"create-placeholder">
  >,
  AssertEqual<WebEventPayloadData<"refresh-token">, SharedEventPayloadData<"refresh-token">>,
  AssertEqual<WebWsServerMessage, SharedWsServerMessage>,
] = [true, true, true, true, true, true, true, true, true, true, true];

describe("WebUI protocol type mirror", () => {
  it("Scenario: Given the WebUI mirrors daemon protocol types, When typechecking, Then the contracts stay exactly aligned", () => {
    expect(protocolMirrorIsExact).toHaveLength(11);
  });
});
