/**
 * Núcleo da busca Gupy. fetch, relógio e escrita entram por argumento
 * para o teste não abrir a rede nem o pipeline.md.
 */

import { SCAN_GUPY_DIR } from '../../career-ops-root.mjs';
import { acceptGupyLocation } from './location-allow.mjs';
import { normalizeGupyItems } from './gupy-normalize.mjs';
import { GUPY_ACTOR_ID, buildGupyInputs } from './gupy-queries.mjs';

export function gupyModuleDir() {
  return SCAN_GUPY_DIR;
}

const APIFY_HOST = 'api.apify.com';
const APIFY_BASE = `https://${APIFY_HOST}/v2`;
const POLL_INTERVAL_MS = 6_000;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadRejectUrl() {
  const { rejectPrivateOrInvalid } =
    await import('../../career-ops/liveness-browser.mjs');
  return rejectPrivateOrInvalid;
}

function assertApifyUrl(url, rejectUrl) {
  const blocked = rejectUrl(url);
  if (blocked) throw new Error(`Blocked URL (${blocked.code}): ${url}`);
  if (new URL(url).hostname !== APIFY_HOST) {
    throw new Error(`Refusing host ${new URL(url).hostname}`);
  }
}

export async function apifyFetch(
  url,
  { method = 'GET', token, fetch: fetchImpl, body, depth = 0, rejectUrl } = {},
) {
  if (!fetchImpl) throw new Error('apifyFetch requires fetch');
  if (depth > 3) throw new Error('Too many Apify redirects');
  const guard = rejectUrl ?? (await loadRejectUrl());
  const absolute = new URL(url).href;
  assertApifyUrl(absolute, guard);

  const sendBody = method !== 'GET' && method !== 'HEAD';
  const res = await fetchImpl(absolute, {
    method,
    redirect: 'manual',
    body: sendBody ? body : undefined,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(sendBody && body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  if (REDIRECT.has(res.status)) {
    const location = res.headers.get('location');
    if (!location) throw new Error(`Redirect ${res.status} without Location`);
    const next = new URL(location, absolute).href;
    assertApifyUrl(next, guard);
    const nextMethod =
      res.status === 307 || res.status === 308 ? method : 'GET';
    return apifyFetch(next, {
      method: nextMethod,
      token,
      fetch: fetchImpl,
      body,
      depth: depth + 1,
      rejectUrl: guard,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Apify API ${res.status}: ${String(text).slice(0, 200)}`);
  }
  return res.json();
}

export async function runActor(
  input,
  {
    token,
    fetch: fetchImpl,
    sleep = defaultSleep,
    now = Date.now,
    actorId = GUPY_ACTOR_ID,
    rejectUrl,
  } = {},
) {
  const start = await apifyFetch(
    `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs`,
    {
      method: 'POST',
      token,
      fetch: fetchImpl,
      body: JSON.stringify(input),
      rejectUrl,
    },
  );
  const runId = start?.data?.id;
  const datasetId = start?.data?.defaultDatasetId;
  if (!runId) {
    throw new Error(
      `No runId returned. Response: ${JSON.stringify(start).slice(0, 200)}`,
    );
  }

  const deadline = now() + RUN_TIMEOUT_MS;
  let status;
  while (now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await apifyFetch(
      `${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}`,
      {
        token,
        fetch: fetchImpl,
        rejectUrl,
      },
    );
    status = statusRes?.data?.status;
    if (status === 'SUCCEEDED') break;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      const message = statusRes?.data?.statusMessage;
      throw new Error(
        `Run ${runId} ended with status: ${status}${message ? ` (${message})` : ''}`,
      );
    }
  }
  if (status !== 'SUCCEEDED')
    throw new Error(`Timeout waiting for gupy (runId: ${runId})`);

  const dataset = await apifyFetch(
    `${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&limit=1000`,
    { token, fetch: fetchImpl, rejectUrl },
  );
  return Array.isArray(dataset) ? dataset : dataset?.items || [];
}

export function selectOffers(
  rawOffers,
  {
    rejectUrl,
    isTargetLocation = acceptGupyLocation,
    titleFilter = () => true,
    findBlacklistEntry = () => null,
    blacklist = new Map(),
    seenUrls = new Set(),
    seenCompanyRoles = new Set(),
    normalizeUrl = (url) => url,
    companyRoleKey = (company, title) =>
      `${String(company || '').toLowerCase()}::${String(title || '').toLowerCase()}`,
  } = {},
) {
  if (typeof rejectUrl !== 'function') {
    throw new Error('selectOffers requires rejectUrl');
  }
  const stats = {
    total: 0,
    filtered_title: 0,
    filtered_location: 0,
    filtered_blocked: 0,
    filtered_url: 0,
    dupes: 0,
    added: 0,
  };
  const offers = [];

  for (const offer of rawOffers) {
    stats.total += 1;
    if (!offer?.title || !offer?.url) continue;
    if (rejectUrl(offer.url)) {
      stats.filtered_url += 1;
      continue;
    }
    if (!isTargetLocation(offer.location)) {
      stats.filtered_location += 1;
      continue;
    }
    if (!titleFilter(offer.title)) {
      stats.filtered_title += 1;
      continue;
    }
    if (findBlacklistEntry(blacklist, offer.company, offer.url)) {
      stats.filtered_blocked += 1;
      continue;
    }
    const urlKey = normalizeUrl(offer.url);
    if (seenUrls.has(urlKey)) {
      stats.dupes += 1;
      continue;
    }
    const roleKey = companyRoleKey(offer.company, offer.title);
    if (seenCompanyRoles.has(roleKey)) {
      stats.dupes += 1;
      continue;
    }
    seenUrls.add(urlKey);
    seenCompanyRoles.add(roleKey);
    offers.push(offer);
    stats.added += 1;
  }

  return { offers, stats };
}

export async function runGupyScan({
  dryRun = false,
  testMode = false,
  token,
  fetch: fetchImpl,
  sleep,
  now,
  profile = {},
  titleFilter = () => true,
  blacklist = new Map(),
  findBlacklistEntry = () => null,
  seenUrls = new Set(),
  seenCompanyRoles = new Set(),
  normalizeUrl,
  companyRoleKey,
  rejectUrl,
  isTargetLocation,
  appendToPipeline = async () => {},
  appendToScanHistory = async () => {},
  date = new Date().toISOString().slice(0, 10),
  log = () => {},
} = {}) {
  const inputs = buildGupyInputs(profile, { testMode });
  const raw = [];
  const errors = [];

  for (const input of inputs) {
    try {
      const items = await runActor(input, {
        token,
        fetch: fetchImpl,
        sleep,
        now,
        rejectUrl,
      });
      raw.push(...normalizeGupyItems(items));
    } catch (err) {
      errors.push({ term: input.searchTerm, error: err.message });
      log(`  error ${input.searchTerm}: ${err.message}`);
    }
  }

  const { offers, stats } = selectOffers(raw, {
    rejectUrl,
    isTargetLocation,
    titleFilter,
    findBlacklistEntry,
    blacklist,
    seenUrls,
    seenCompanyRoles,
    normalizeUrl,
    companyRoleKey,
  });

  log(
    `title-filtered: ${stats.filtered_title} | location-filtered: ${stats.filtered_location} | blocked: ${stats.filtered_blocked} | dupes: ${stats.dupes} | new: ${stats.added}`,
  );

  if (!dryRun && offers.length > 0) {
    await appendToPipeline(offers);
    await appendToScanHistory(offers, date);
  }

  return { added: stats.added, offers, stats, errors };
}
