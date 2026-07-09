export interface EnsureIconsOptions {
  cacheRoot: string;
  root?: string;
  force?: boolean;
}

export interface EnsureIconsResult {
  dir: string;
  hash: string;
  generated: boolean;
}

export declare function ensureIcons(options: EnsureIconsOptions): Promise<EnsureIconsResult>;
