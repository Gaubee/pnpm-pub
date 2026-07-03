import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import { webRpcContract, type WebRpcContract } from "$shared/orpc-contract.js";

export type WebRpcClient = ContractRouterClient<WebRpcContract>;

export function createWebRpcClient(websocket: WebSocket): WebRpcClient {
  const link = new RPCLink({ websocket });
  return createORPCClient<WebRpcClient>(link);
}

export { webRpcContract };
