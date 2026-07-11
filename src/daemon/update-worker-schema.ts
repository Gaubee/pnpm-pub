import { z } from "zod";
import { AppUpdateManagerSchema } from "../shared/schemas.js";

const WorkerRuntimeSchema = z.object({
  daemonPid: z.number().int().positive(),
  daemonEntry: z.string().min(1),
  nodePath: z.string().min(1),
  env: z.record(z.string(), z.string().optional()),
});

/** Serialization boundary for each independent update-worker action. */
export const AppUpdateWorkerRequestSchema = z.discriminatedUnion("action", [
  WorkerRuntimeSchema.extend({
    action: z.literal("install"),
    manager: AppUpdateManagerSchema.exclude(["unknown"]),
    executable: z.string().min(1),
    packageRoot: z.string().min(1),
    expectedVersion: z.string().min(1),
  }),
  WorkerRuntimeSchema.extend({ action: z.literal("restart") }),
]);
export type AppUpdateWorkerRequest = z.infer<typeof AppUpdateWorkerRequestSchema>;
