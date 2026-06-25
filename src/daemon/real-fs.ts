/**
 * Real-filesystem adapter for the workspace engine.
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fsp, statSync } from 'node:fs';
import type { fs as FsAPI } from './fs-types.js';

export const realFs: FsAPI = {
  join: (...parts: string[]) => path.join(...parts),
  dirname: (p: string) => path.dirname(p),
  home: () => os.homedir(),
  async exists(p: string): Promise<boolean> {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  },
  async isDirectory(p: string): Promise<boolean> {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  async readdir(p: string): Promise<string[]> {
    return fsp.readdir(p);
  },
  async readFile(p: string): Promise<string> {
    return fsp.readFile(p, 'utf8');
  },
};
