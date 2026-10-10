#!/usr/bin/env node

/**
 * Busca vagas na Gupy e acrescenta as novas ao inbox do career-ops.
 *
 *   npm run scan:gupy:dry
 *   npm run scan:gupy
 *   npm run scan:gupy -- --test
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import yaml from 'js-yaml';
import { PROJECT_ROOT } from '../../career-ops-root.mjs';
import { getCareerOpsRoot } from '../../career-ops/path-resolver.mjs';
import { rejectPrivateOrInvalid } from '../../career-ops/liveness-browser.mjs';
import {
  appendToPipeline,
  appendToScanHistory,
  buildTitleFilter,
  companyRoleDedupKey,
  findBlacklistEntry,
  loadBlacklist,
  loadSeenCompanyRoles,
  loadSeenUrls,
  normalizeUrlForDedup,
  PORTALS_PATH,
} from '../../career-ops/scan.mjs';
import { loadApifyToken } from './load-apify-token.mjs';
import { runGupyScan } from './gupy-scan-core.mjs';

config({ path: join(PROJECT_ROOT, '.env') });

function loadProfile() {
  const profilePath = join(getCareerOpsRoot(), 'config', 'profile.yml');
  if (!existsSync(profilePath)) return {};
  return yaml.load(readFileSync(profilePath, 'utf8')) ?? {};
}

function loadTitleFilter() {
  if (!existsSync(PORTALS_PATH)) return () => true;
  const portals = yaml.load(readFileSync(PORTALS_PATH, 'utf8')) ?? {};
  return buildTitleFilter(portals.title_filter);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`Uso: npm run scan:gupy -- [--dry-run] [--test]

  --dry-run   Consulta o actor e não escreve o inbox.
  --test      3 termos, 15 resultados por termo.`);
    return;
  }

  const dryRun = args.includes('--dry-run');
  const testMode = args.includes('--test');

  let token;
  try {
    ({ token } = loadApifyToken());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const { seen: seenUrls } = loadSeenUrls();
  const result = await runGupyScan({
    dryRun,
    testMode,
    token,
    fetch: globalThis.fetch,
    profile: loadProfile(),
    titleFilter: loadTitleFilter(),
    blacklist: loadBlacklist(),
    findBlacklistEntry,
    seenUrls,
    seenCompanyRoles: loadSeenCompanyRoles(),
    normalizeUrl: normalizeUrlForDedup,
    companyRoleKey: (company, title) => companyRoleDedupKey(company, title),
    rejectUrl: rejectPrivateOrInvalid,
    appendToPipeline,
    appendToScanHistory,
    log: (line) => console.log(line),
  });

  if (result.errors.length > 0) process.exitCode = 1;
}

if (/(^|[\\/])scan-gupy\.mjs$/.test(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
