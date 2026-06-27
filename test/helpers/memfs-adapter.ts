/**
 * memfs adapter for the workspace engine tests (Chapter 10.1.3).
 * Lets us build an entire virtual monorepo in memory and scan it.
 */
import path from 'node:path';
import { Volume, createFsFromVolume } from 'memfs';
import type { IFs } from 'memfs';
import type { fs as FsAPI } from '../../src/daemon/fs-types.js';

export const ROOT = '/proj';

export interface MemVolume {
  /** The fs facade the scanner talks to. */
  fs: FsAPI;
  /** Write a file (creating parent dirs). */
  write(filePath: string, contents: string): void;
  /** Raw memfs volume (for assertions). */
  vol: Volume;
}

export function makeVolume(): MemVolume {
  const vol = new Volume();
  const mem: IFs = createFsFromVolume(vol);

  const fs: FsAPI = {
    join: (...parts: string[]) => path.posix.join(...parts),
    dirname: (p) => path.posix.dirname(p),
    home: () => '/home/test',
    async exists(p) {
      return mem.existsSync(p);
    },
    async isDirectory(p) {
      try {
        const s = await mem.promises.stat(p);
        return s.isDirectory();
      } catch {
        return false;
      }
    },
    async readdir(p) {
      return mem.promises.readdir(p);
    },
    async readFile(p) {
      const data = await mem.promises.readFile(p);
      // memfs returns a Uint8Array; coerce to a UTF-8 string.
      if (typeof data === 'string') return data;
      return Buffer.from(data).toString('utf8');
    },
  };

  return {
    fs,
    vol,
    write(filePath, contents) {
      const dir = path.posix.dirname(filePath);
      vol.mkdirSync(dir, { recursive: true });
      vol.writeFileSync(filePath, contents);
    },
  };
}
