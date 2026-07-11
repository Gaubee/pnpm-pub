import validatePackageName from "validate-npm-package-name";

export interface NpmPackageNameValidation {
  name: string;
  valid: boolean;
  errors: readonly string[];
}

/** Lowercase the package identity without silently repairing other invalid input. */
export function normalizeNpmPackageName(name: string): string {
  return name.toLowerCase();
}

/** Validate a normalized package identity against npm's canonical naming rules. */
export function validateNpmPackageName(name: string): NpmPackageNameValidation {
  const normalized = normalizeNpmPackageName(name);
  const result = validatePackageName(normalized);
  return {
    name: normalized,
    valid: result.validForNewPackages,
    errors: result.errors ?? result.warnings ?? [],
  };
}
