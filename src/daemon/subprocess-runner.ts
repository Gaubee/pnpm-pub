/**
 * Low-level `pnpm` subprocess runner: arg normalization, streaming capture,
 * and outcome → result classification. Extracted from `publisher.ts` so the
 * subprocess mechanics are testable independently of the OTP / drift-recovery
 * orchestration that sits on top.
 */
import { execa } from 'execa';
import { generateTotp, totpAfterDrift, parseHttpDate } from './totp.js';
import { isOtpFailureText, isExpiredTokenText } from './npm-api.js';
import { withTempNpmrc } from './npmrc-auth.js';

/** Log sink — the scheduler's PendingClient (CLI terminal + WebUI relay). */
export interface PublishLogSink {
  log(stream: 'stdout' | 'stderr', data: string): void;
}

/** Result shape aligned with `npm-api.ts:PublishResult` so the scheduler can
 *  treat both paths uniformly. */
export interface CliPublishResult {
  ok: boolean;
  status?: number;
  /** Best-effort parsed error message. */
  error?: string;
  /** True when a clock-drift retry path was taken and succeeded (Chapter 8.4). */
  clockDriftRecovered?: boolean;
  /** True when the registry rejected the token as expired/invalid/revoked. */
  expired?: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Remove options from the forwarded argv that the runner injects itself
 * (authoritatively), so we never pass a duplicate `--otp`/`--registry`. Each
 * option can appear as `--flag value` (drop the following token too) or
 * `--flag=value` (drop just the one token).
 */
export function stripOverriddenArgs(args: string[], flags: string[]): string[] {
  const flagSet = new Set(flags);
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (flagSet.has(arg)) {
      // `--otp value` form: skip the value token too (unless it's itself a flag).
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) i += 1;
      continue;
    }
    if (flags.some((f) => arg.startsWith(`${f}=`))) continue;
    out.push(arg);
  }
  return out;
}

/** Ensure the recursive flag is present in the forwarded argv. Recognizes the
 *  `-r`/`--recursive` aliases and pnpm's legacy `-m`/`--multi` as "already
 *  recursive" so we never prepend a duplicate. */
export function ensureRecursive(args: string[]): string[] {
  const alreadyRecursive = args.some((arg) => arg === '-r' || arg === '--recursive' || arg === '-m' || arg === '--multi');
  return alreadyRecursive ? args : ['-r', ...args];
}

interface RunPublishSubprocessOpts {
  cwd: string;
  /** Full argv AFTER the `publish` verb. */
  args: string[];
  registry: string;
  token: string;
  otp: string;
  sink: PublishLogSink;
}

interface SubprocessOutcome {
  exitCode: number;
  /** Accumulated stderr (for OTP / expired detection). */
  stderr: string;
}

/** Best-effort extraction of the human message from pnpm/npm stderr. */
export function extractNpmError(stderr: string): string | undefined {
  // `npm error <message>` lines carry the most actionable text.
  const errorLines = stderr
    .split('\n')
    .filter((l) => /^\s*npm error\b/i.test(l))
    .map((l) => l.replace(/^\s*npm error\s*/i, '').trim())
    .filter(Boolean);
  if (errorLines.length > 0) {
    // Prefer the line that looks like the root cause (not the log-path line).
    const cause = errorLines.find((l) => !/log of this run can be found/i.test(l));
    return cause ?? errorLines[0];
  }
  // Fallback: pnpm's own `ERROR` lines.
  const pnpmError = stderr
    .split('\n')
    .map((l) => l.replace(/^\s*ERROR\s*/i, '').trim())
    .filter(Boolean)[0];
  return pnpmError || undefined;
}

/** Spawn `pnpm publish ...`, stream stdout/stderr to the sink, return outcome. */
async function runPublishSubprocess(opts: RunPublishSubprocessOpts): Promise<SubprocessOutcome> {
  return withTempNpmrc(opts.cwd, opts.registry, opts.token, async () => {
    // Strip any --otp/--registry the caller already carried: the runner injects
    // authoritative values below (--otp from the TOTP secret, registry via the
    // temporary .npmrc) and pnpm rejects duplicate flags.
    const args = stripOverriddenArgs(opts.args, ['--otp', '--registry']);
    const subprocess = execa(
      'pnpm',
      ['publish', ...args, '--otp', opts.otp],
      { cwd: opts.cwd, reject: false, buffer: false },
    );
    let stderr = '';
    const drain = async (stream: NodeJS.ReadableStream | AsyncIterable<unknown> | null, tag: 'stdout' | 'stderr'): Promise<void> => {
      if (!stream || typeof (stream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function') return;
      for await (const chunk of stream as AsyncIterable<unknown>) {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
        if (tag === 'stderr') stderr += text;
        opts.sink.log(tag, text);
      }
    };
    await Promise.all([drain(subprocess.stdout, 'stdout'), drain(subprocess.stderr, 'stderr')]);
    const result = await subprocess;
    return classifyOutcome(result, stderr, opts.sink);
  });
}

/** The shape execa resolves to (success or, with reject:false, an error-like). */
type ExecaResult = Awaited<ReturnType<typeof execa>>;

/**
 * Map an execa result to a SubprocessOutcome. `exitCode` is undefined when the
 * process was killed by a signal or failed to spawn (e.g. ENOENT despite a
 * prior hasPnpm probe). Treat that as a failure rather than masking it as
 * success (exit 0).
 */
function classifyOutcome(result: ExecaResult, capturedStderr: string, sink: PublishLogSink): SubprocessOutcome {
  let stderr = capturedStderr;
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : -1;
  if (exitCode === -1 && !stderr) {
    stderr = result.originalMessage ? `pnpm spawn failed: ${result.originalMessage}` : 'pnpm publish terminated unexpectedly.';
    sink.log('stderr', stderr + '\n');
  }
  return { exitCode, stderr };
}

/** Build the final result from a subprocess outcome. */
function outcomeToResult(outcome: SubprocessOutcome, explicitOtp: boolean): CliPublishResult {
  if (outcome.exitCode === 0) {
    return { ok: true, status: 200, stdout: '', stderr: outcome.stderr };
  }
  const stderr = outcome.stderr;
  if (isExpiredTokenText(stderr)) {
    return { ok: false, status: 401, expired: true, error: extractNpmError(stderr), stdout: '', stderr };
  }
  if (isOtpFailureText(stderr) && !explicitOtp) {
    return { ok: false, status: 403, error: extractNpmError(stderr) ?? 'OTP validation failed', stdout: '', stderr };
  }
  return { ok: false, status: 1, error: extractNpmError(stderr) ?? `pnpm publish failed (exit ${outcome.exitCode})`, stdout: '', stderr };
}

/** Fetch the registry's server `Date` header (epoch ms) for drift recovery. */
async function fetchServerDateMs(registry: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(registry, { method: 'GET', signal: controller.signal });
    return parseHttpDate(res.headers.get('date'));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface RunPublishOpts {
  cwd: string;
  args: string[];
  registry: string;
  token: string;
  totpSecret: string;
  /** One-shot OTP supplied via CLI `--otp` (overrides the TOTP secret). */
  otp?: string;
  sink: PublishLogSink;
}

/**
 * Run the already-assembled `pnpm publish [...]` argv, deriving the OTP from
 * the secret and applying clock-drift self-healing (Chapter 8.4): on an OTP
 * failure, read the registry server time, recompute the OTP, retry once.
 */
export async function runPublishWithDriftRecovery(opts: RunPublishOpts): Promise<CliPublishResult> {
  const { cwd, args, registry, token, totpSecret, sink } = opts;
  const explicitOtp = opts.otp && opts.otp.length > 0 ? opts.otp : undefined;
  const firstOtp = explicitOtp ?? generateTotp(totpSecret);
  const first = await runPublishSubprocess({ cwd, args, registry, token, otp: firstOtp, sink });
  if (first.exitCode === 0) return { ok: true, status: 200, stdout: '', stderr: first.stderr };

  const firstResult = outcomeToResult(first, !!explicitOtp);

  // Clock-drift recovery (Chapter 8.4): retry ONLY on OTP failures, once.
  if (firstResult.status === 403 && !explicitOtp) {
    const serverMs = await fetchServerDateMs(registry);
    if (serverMs !== null) {
      const correctedOtp = totpAfterDrift(totpSecret, serverMs);
      const retry = await runPublishSubprocess({ cwd, args, registry, token, otp: correctedOtp, sink });
      if (retry.exitCode === 0) {
        return { ok: true, status: 200, clockDriftRecovered: true, stdout: '', stderr: retry.stderr };
      }
      return outcomeToResult(retry, false);
    }
  }

  return firstResult;
}
