/**
 * Filesystem abstraction so the workspace engine can run against either the
 * real `node:fs` or an in-memory `memfs` volume in tests (Chapter 10.1).
 *
 * The shape intentionally mirrors the small subset of fs APIs the scanner uses.
 */
export interface fs {
  join(...parts: string[]): string;
  dirname(p: string): string;
  exists(p: string): Promise<boolean>;
  isDirectory(p: string): Promise<boolean>;
  readdir(p: string): Promise<string[]>;
  readFile(p: string): Promise<string>;
  home(): string;
}
