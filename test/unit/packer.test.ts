import { afterEach, describe, expect, it } from "vite-plus/test";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import {
  normalizeOutputChunk,
  packPackage,
  readPackageTarball,
  summarizePackageTarball,
} from "../../src/daemon/packer.js";

const sandbox = path.join(os.tmpdir(), `pnpm-pub-packer-${process.pid}-${Date.now()}`);

afterEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("Feature: packer package metadata boundary", () => {
  it("Scenario: Given package.json is not an object, When packing starts, Then metadata is rejected before shelling out", async () => {
    await fsp.mkdir(sandbox, { recursive: true });
    await fsp.writeFile(path.join(sandbox, "package.json"), "[]", "utf8");

    await expect(packPackage(sandbox)).rejects.toThrow("Invalid package.json metadata.");
  });
});

describe("Feature: packer source-directory conservation", () => {
  it("Scenario: Given package-local tarballs already exist, When packing, Then user artifacts are preserved", async () => {
    const packageDir = path.join(sandbox, "preserve-tarballs");
    const existingTarball = path.join(packageDir, "existing-artifact.tgz");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "preserve-tarballs", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageDir, "index.js"), "export {};\n", "utf8");
    await fsp.writeFile(existingTarball, "user-owned artifact", "utf8");

    const result = await packPackage(packageDir);

    expect(result.metadata).toMatchObject({ name: "preserve-tarballs", version: "1.0.0" });
    expect(result.tarball.length).toBeGreaterThan(0);
    await expect(fsp.readFile(existingTarball, "utf8")).resolves.toBe("user-owned artifact");
    await expect(
      fsp.access(path.join(packageDir, "preserve-tarballs-1.0.0.tgz")),
    ).rejects.toThrow();
  });

  it("Scenario: Given ignoreScripts is requested, When packing, Then package lifecycle scripts do not run", async () => {
    const packageDir = path.join(sandbox, "ignore-scripts");
    const scriptOutput = path.join(packageDir, "script-ran.txt");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "ignore-scripts",
        version: "1.0.0",
        scripts: {
          prepack: "node -e \"require('fs').writeFileSync('script-ran.txt', 'yes')\"",
        },
      }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageDir, "index.js"), "export {};\n", "utf8");

    const result = await packPackage(packageDir, { ignoreScripts: true });

    expect(result.metadata).toMatchObject({ name: "ignore-scripts", version: "1.0.0" });
    await expect(fsp.access(scriptOutput)).rejects.toThrow();
  });
});

describe("Feature: packer tarball source conservation", () => {
  it("Scenario: Given an existing npm package tarball, When reading it as publish source, Then embedded metadata and bytes are preserved", async () => {
    const packageDir = path.join(sandbox, "read-tarball-source");
    const tarballPath = path.join(sandbox, "read-tarball-source-1.0.0.tgz");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "read-tarball-source", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageDir, "index.js"), "export {};\n", "utf8");

    const packed = await packPackage(packageDir);
    await fsp.writeFile(tarballPath, packed.tarball);

    const read = await readPackageTarball(tarballPath);

    expect(read.metadata).toMatchObject({ name: "read-tarball-source", version: "1.0.0" });
    expect(read.tarball).toEqual(packed.tarball);
  });

  it("Scenario: Given a packed npm package, When summarizing it for publish JSON, Then native file-list facts are projected from the tarball", async () => {
    const packageDir = path.join(sandbox, "summarize-tarball-source");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "summarize-tarball-source", version: "1.0.0", files: ["index.js"] }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageDir, "index.js"), "export const value = 1;\n", "utf8");

    const packed = await packPackage(packageDir);
    const summary = await summarizePackageTarball(packed.tarball);

    expect(summary.unpackedSize).toBeGreaterThan(0);
    expect(summary.entryCount).toBe(summary.files.length);
    expect(summary.bundled).toEqual([]);
    expect(summary.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "package.json",
          size: expect.any(Number),
          mode: expect.any(Number),
        }),
        expect.objectContaining({
          path: "index.js",
          size: expect.any(Number),
          mode: expect.any(Number),
        }),
      ]),
    );
  });

  it("Scenario: Given a packed package with bundled dependencies, When summarizing it, Then bundled files stay out of own package contents", async () => {
    const packageDir = path.join(sandbox, "summarize-bundled-tarball-source");
    const dependencyDir = path.join(packageDir, "node_modules/local-dep");
    await fsp.mkdir(dependencyDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "pnpm-workspace.yaml"),
      "nodeLinker: hoisted\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "summarize-bundled-tarball-source",
        version: "1.0.0",
        dependencies: { "local-dep": "1.0.0" },
        bundleDependencies: ["local-dep"],
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(dependencyDir, "package.json"),
      JSON.stringify({ name: "local-dep", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(dependencyDir, "index.js"), "module.exports = 1;\n", "utf8");

    const packed = await packPackage(packageDir);
    const summary = await summarizePackageTarball(packed.tarball);

    expect(summary.bundled).toEqual(["local-dep"]);
    expect(summary.entryCount).toBeGreaterThan(summary.files.length);
    expect(summary.unpackedSize).toBeGreaterThan(
      summary.files.reduce((total, file) => total + file.size, 0),
    );
    expect(summary.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "package.json",
          size: expect.any(Number),
          mode: expect.any(Number),
        }),
      ]),
    );
    expect(summary.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "node_modules/local-dep/package.json" }),
        expect.objectContaining({ path: "node_modules/local-dep/index.js" }),
      ]),
    );
  });
});

describe("Feature: packer command output boundary", () => {
  it("Scenario: Given process output chunks, When normalizing them, Then only known byte/string shapes become captured output", () => {
    expect(normalizeOutputChunk(Buffer.from("buffer"))?.toString("utf8")).toBe("buffer");
    expect(normalizeOutputChunk("string")?.toString("utf8")).toBe("string");
    expect(normalizeOutputChunk(new Uint8Array([117, 56]))?.toString("utf8")).toBe("u8");
    expect(normalizeOutputChunk({ value: "not-output" })).toBeNull();
  });
});
