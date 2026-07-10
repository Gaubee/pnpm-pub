import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const releaseManifestSchema = z.object({
  name: z.literal("pnpm-pub"),
  version: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Expected a stable semantic version"),
});

/** Enforce conservation between the GitHub Release tag and package manifest. */
export function verifyReleaseVersion(manifest: unknown, releaseTag: string): string {
  const parsed = releaseManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new Error(`Invalid release package manifest: ${z.prettifyError(parsed.error)}`);
  }

  const expectedTag = `v${parsed.data.version}`;
  if (releaseTag !== expectedTag) {
    throw new Error(`Release tag ${JSON.stringify(releaseTag)} must equal ${expectedTag}.`);
  }
  return parsed.data.version;
}

async function main(): Promise<void> {
  const releaseTag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";
  const manifest: unknown = JSON.parse(await readFile("package.json", "utf8"));
  process.stdout.write(`${verifyReleaseVersion(manifest, releaseTag)}\n`);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
