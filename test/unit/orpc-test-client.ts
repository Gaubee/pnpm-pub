import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import { WebSocket } from "ws";
import type { WebRpcContract } from "../../src/shared/orpc-contract.js";

export type WebRpcTestClient = ContractRouterClient<WebRpcContract>;

export interface WebRpcTestConnection {
  ws: WebSocket;
  client: WebRpcTestClient;
  rawCall(path: readonly string[], input: unknown): Promise<unknown>;
  close(): void;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function openRpcSocket(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/rpc?token=${token}`);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
    setTimeout(() => reject(new Error("socket timeout")), 3_000);
  });
}

export async function openRpcClient(port: number, token: string): Promise<WebRpcTestConnection> {
  const ws = await openRpcSocket(port, token);
  const link = new RPCLink({ websocket: ws });
  return {
    ws,
    client: createORPCClient<WebRpcTestClient>(link),
    rawCall: (path, input) => link.call(path, input, { context: {} }),
    close() {
      ws.close();
    },
  };
}
