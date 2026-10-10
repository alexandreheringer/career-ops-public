import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTargetLocation } from './location-allow.mjs';
import { normalizeGupyItems } from './gupy-normalize.mjs';
import { runActor, runGupyScan, selectOffers } from './gupy-scan-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAREER_OPS = join(HERE, '..', '..', 'career-ops');
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, 'fixtures/gupy-items.json'), 'utf8'),
);

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Guard local. O CI não tem o checkout career-ops. */
function rejectUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { code: 'invalid', reason: 'invalid' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { code: 'protocol', reason: parsed.protocol };
  }
  const host = parsed.hostname;
  if (
    host === '169.254.169.254' ||
    host === 'localhost' ||
    host.endsWith('.local')
  ) {
    return { code: 'private', reason: host };
  }
  return null;
}

function clock() {
  let t = 0;
  return () => {
    t += 1000;
    return t;
  };
}

function actorFetch(items = FIXTURE) {
  return async (url, init = {}) => {
    const target = String(url);
    if (init.redirect && init.redirect !== 'manual') {
      throw new Error(`redirect must be manual, got ${init.redirect}`);
    }
    if (target.includes('/datasets/')) return jsonResponse(items);
    if (target.includes('/actor-runs/'))
      return jsonResponse({ data: { status: 'SUCCEEDED' } });
    return jsonResponse({ data: { id: 'run-1', defaultDatasetId: 'ds-1' } });
  };
}

test('isTargetLocation aceita Brasil e Remote e recusa Argentina', () => {
  assert.equal(isTargetLocation('Brasil'), true);
  assert.equal(isTargetLocation('Remote'), true);
  assert.equal(isTargetLocation('Argentina'), false);
});

test('selectOffers descarta URL privada e mantém a vaga pública', () => {
  const { offers } = selectOffers(
    [
      {
        title: 'Analista de Dados',
        url: 'http://169.254.169.254/latest',
        company: 'Acme',
        location: 'Brasil',
        source: 'scan-gupy',
      },
      {
        title: 'Analista de Dados',
        url: 'file:///etc/passwd',
        company: 'Acme',
        location: 'Brasil',
        source: 'scan-gupy',
      },
      {
        title: 'Analista de Dados',
        url: 'https://empresa.gupy.io/job/1',
        company: 'Acme',
        location: 'Brasil',
        source: 'scan-gupy',
      },
    ],
    {
      rejectUrl,
      isTargetLocation,
      titleFilter: () => true,
      findBlacklistEntry: () => null,
    },
  );
  assert.deepEqual(
    offers.map((offer) => offer.url),
    ['https://empresa.gupy.io/job/1'],
  );
});

test('dry-run não escreve e a segunda passagem conta duplicata', async () => {
  let pipelineCalls = 0;
  let historyCalls = 0;
  const seenUrls = new Set();
  const seenCompanyRoles = new Set();
  const shared = {
    dryRun: true,
    fetch: actorFetch(),
    sleep: async () => {},
    now: clock(),
    token: 'apify_api_test_token_value',
    profile: {},
    titleFilter: () => true,
    findBlacklistEntry: () => null,
    rejectUrl,
    seenUrls,
    seenCompanyRoles,
    appendToPipeline: async () => {
      pipelineCalls += 1;
    },
    appendToScanHistory: async () => {
      historyCalls += 1;
    },
  };

  const first = await runGupyScan(shared);
  const second = await runGupyScan({ ...shared, now: clock() });
  const accepted = normalizeGupyItems(FIXTURE);

  assert.equal(pipelineCalls, 0);
  assert.equal(historyCalls, 0);
  assert.equal(first.added, accepted.length);
  assert.equal(second.added, 0);
  assert.ok(second.stats.dupes >= accepted.length);
});

test('sem dry-run escreve uma vez, histórico só depois do pipeline', async () => {
  let pipelineResolved = false;
  let pipelineCalls = 0;
  let historyCalls = 0;
  /** @type {unknown[]|undefined} */
  let written;

  const result = await runGupyScan({
    dryRun: false,
    fetch: actorFetch(),
    sleep: async () => {},
    now: clock(),
    token: 'apify_api_test_token_value',
    profile: {},
    titleFilter: () => true,
    findBlacklistEntry: () => null,
    rejectUrl,
    appendToPipeline: async (offers) => {
      pipelineCalls += 1;
      written = offers;
      await Promise.resolve();
      pipelineResolved = true;
    },
    appendToScanHistory: async () => {
      if (!pipelineResolved)
        throw new Error('history ran before pipeline resolved');
      historyCalls += 1;
    },
  });

  assert.equal(pipelineCalls, 1);
  assert.equal(historyCalls, 1);
  assert.equal(Array.isArray(written), true);
  assert.equal(written.length, result.added);
});

test('redirect para IP privado não é seguido', async () => {
  let calls = 0;
  await assert.rejects(() =>
    runActor(
      { searchTerm: 'dados', state: '', sortBy: 'newest', maxResults: 1 },
      {
        token: 'apify_api_test_token_value',
        sleep: async () => {},
        now: clock(),
        rejectUrl,
        fetch: async () => {
          calls += 1;
          return new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/' },
          });
        },
      },
    ),
  );
  assert.equal(calls, 1);
});

test('redirect dentro de api.apify.com é seguido', async () => {
  const urls = [];
  await runActor(
    { searchTerm: 'dados', state: '', sortBy: 'newest', maxResults: 1 },
    {
      token: 'apify_api_test_token_value',
      sleep: async () => {},
      now: clock(),
      rejectUrl,
      fetch: async (url) => {
        urls.push(String(url));
        if (urls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://api.apify.com/v2/actor-runs/1' },
          });
        }
        if (String(url).includes('/datasets/')) return jsonResponse([]);
        if (String(url).includes('/actor-runs/')) {
          return jsonResponse({
            data: {
              id: 'run-1',
              status: 'SUCCEEDED',
              defaultDatasetId: 'ds-1',
            },
          });
        }
        return jsonResponse({
          data: { id: 'run-1', defaultDatasetId: 'ds-1' },
        });
      },
    },
  );
  assert.equal(urls[1], 'https://api.apify.com/v2/actor-runs/1');
});

test('formatPipelineOffer emite url, empresa e cargo', async (t) => {
  if (!existsSync(join(CAREER_OPS, 'scan.mjs'))) {
    t.skip('career-ops checkout ausente');
    return;
  }
  const { formatPipelineOffer } = await import('../../career-ops/scan.mjs');
  const line = formatPipelineOffer({
    url: 'https://empresa.gupy.io/job/1',
    company: 'Acme',
    title: 'Analista de Dados',
    location: 'São Paulo, SP',
    source: 'scan-gupy',
  });
  assert.equal(line.startsWith('- [ ] https://'), true);
  assert.ok(line.split(' | ').length >= 3);
});

test('o CLI entrega rejectPrivateOrInvalid ao núcleo', () => {
  const cli = readFileSync(join(HERE, 'scan-gupy.mjs'), 'utf8');
  assert.match(cli, /rejectPrivateOrInvalid/);
  assert.match(cli, /rejectUrl:\s*rejectPrivateOrInvalid/);
  assert.match(cli, /const \{ seen: seenUrls \} = loadSeenUrls\(\)/);
  assert.doesNotMatch(cli, /seenUrls:\s*loadSeenUrls\(\)/);
});
