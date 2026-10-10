/**
 * Token Apify sem shell. OP_APIFY_REF passa por allowlist e execFileSync.
 * Falha do cofre não cai para um APIFY_TOKEN antigo.
 */

import { execFileSync, spawnSync } from 'node:child_process';

const OP_REF_RE =
  /^op:\/\/[A-Za-z0-9 ._-]{1,100}(?:\/[A-Za-z0-9 ._-]{1,100}){1,3}$/;
const MIN_TOKEN_LENGTH = 20;

export function loadApifyToken({ env = process.env } = {}) {
  const opRef = env.OP_APIFY_REF?.trim();
  if (opRef) {
    if (!OP_REF_RE.test(opRef)) {
      throw new Error(
        'OP_APIFY_REF is not a valid 1Password secret reference. The value is refused rather than passed to the shell.',
      );
    }
    const probe = spawnSync('op', ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (probe.error || probe.status !== 0) {
      throw new Error(
        'OP_APIFY_REF is set but the 1Password CLI (op) is not available on PATH.',
      );
    }
    let token;
    try {
      token = execFileSync('op', ['read', opRef], {
        encoding: 'utf8',
        timeout: 120_000,
      }).trim();
    } catch {
      throw new Error(
        `Failed to read the Apify token from 1Password (${opRef}). Check that you are signed in.`,
      );
    }
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new Error(
        `1Password returned a value too short to be an Apify token (${token.length} chars).`,
      );
    }
    return { token, source: '1password' };
  }
  const direct = env.APIFY_TOKEN?.trim();
  if (direct && direct.length >= MIN_TOKEN_LENGTH) {
    return { token: direct, source: 'env' };
  }
  throw new Error('No Apify token found. Set OP_APIFY_REF or APIFY_TOKEN.');
}
