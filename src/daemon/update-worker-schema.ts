import { z } from "zod";
import { AppUpdateManagerSchema } from "../shared/schemas.js";

/** Serialization boundary for the detached update worker invocation. */
export const AppUpdateWorkerRequestSchema = z.object({
  manager: AppUpdateManagerSchema.exclude(["unknown"]),
  executable: z.string().min(1),
  packageRoot: z.string().min(1),
  expectedVersion: z.string().min(1),
  daemonPid: z.number().int().positive(),
  daemonEntry: z.string().min(1),
  nodePath: z.string().min(1),
  env: z.record(z.string(), z.string().optional()),
});
