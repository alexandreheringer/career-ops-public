import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTargetLocation } from './location-allow.mjs';
import { normalizeIndeedItems } from './indeed-normalize.mjs';
import { runActor, runIndeedScan, selectOffers } from './indeed-scan-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAREER_OPS = join(HERE, '..', '..', 'career-ops');
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, 'fixtures/indeed-items.json'), 'utf8'),
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
    host === '127.0.0.1' ||
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

function actorFetch(items = FIXTURE, { failCountries = [] } = {}) {
  return async (url, init = {}) => {
    const target = String(url);
    if (init.redirect && init.redirect !== 'manual') {
      throw new Error(`redirect must be manual, got ${init.redirect}`);
    }
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      if (failCountries.includes(body.country)) {
        return new Response('boom', { status: 500 });
      }
      return jsonResponse({
        data: {
          id: `run-${body.country}`,
          defaultDatasetId: `ds-${body.country}`,
        },
      });
    }
    if (target.includes('/datasets/')) return jsonResponse(items);
    if (target.includes('/actor-runs/')) {
      return jsonResponse({ data: { status: 'SUCCEEDED' } });
    }
    return jsonResponse({ data: { id: 'run-1', defaultDatasetId: 'ds-1' } });
  };
}

const PROFILE = {
  target_roles: { primary: ['Senior Data Engineer'] },
};

test('Lisboa com o país passa e Argentina fica fora', () => {
  assert.equal(isTargetLocation('Lisboa, Portugal'), true);
  assert.equal(isTargetLocation('Argentina'), false);
});

test('selectOffers descarta URL privada', () => {
  const { offers } = selectOffers(
    [
      {
        title: 'Senior Data Engineer',
        url: 'http://169.254.169.254/latest',
        company: 'Acme',
        location: 'Lisboa, Portugal',
        source: 'scan-indeed',
      },
      {
        title: 'Senior Data Engineer',
        url: 'https://www.indeed.com/viewjob?jk=abc123',
        company: 'Acme',
        location: 'Lisboa, Portugal',
        source: 'scan-indeed',
      },
    ],
    {
      rejectUrl,
      isTargetLocation,
      titleFilter: () => true,
      findBlacklistEntry: () => null,
      blacklist: new Map(),
      seenUrls: new Set(),
      seenCompanyRoles: new Set(),
    },
  );
  assert.deepEqual(
    offers.map((offer) => offer.url),
    ['https://www.indeed.com/viewjob?jk=abc123'],
  );
});

test('blacklist e URL já vista são literais e ficam de fora', () => {
  const seenUrls = new Set(['https://www.indeed.com/viewjob?jk=seen']);
  const { offers, stats } = selectOffers(
    [
      {
        title: 'Senior Data Engineer',
        url: 'https://www.indeed.com/viewjob?jk=blocked',
        company: 'Blocked Co',
        location: 'Portugal',
        source: 'scan-indeed',
      },
      {
        title: 'Senior Data Engineer',
        url: 'https://www.indeed.com/viewjob?jk=seen',
        company: 'Acme',
        location: 'Portugal',
        source: 'scan-indeed',
      },
      {
        title: 'Senior Data Engineer',
        url: 'https://www.indeed.com/viewjob?jk=new',
        company: 'Acme',
        location: 'Portugal',
        source: 'scan-indeed',
      },
    ],
    {
      rejectUrl,
      isTargetLocation,
      titleFilter: () => true,
      blacklist: new Map([['blocked co', { company: 'Blocked Co' }]]),
      findBlacklistEntry: (blacklist, company) =>
        blacklist.get(String(company).toLowerCase()) ?? null,
      seenUrls,
      seenCompanyRoles: new Set(),
      normalizeUrl: (url) => url,
    },
  );
  assert.deepEqual(
    offers.map((offer) => offer.url),
    ['https://www.indeed.com/viewjob?jk=new'],
  );
  assert.equal(stats.filtered_blocked, 1);
  assert.equal(stats.dupes, 1);
});

test('dry-run não escreve', async () => {
  let pipelineCalls = 0;
  let historyCalls = 0;
  const result = await runIndeedScan({
    dryRun: true,
    fetch: actorFetch(),
    sleep: async () => {},
    now: clock(),
    token: 'apify_api_test_token_value',
    profile: PROFILE,
    titleFilter: () => true,
    findBlacklistEntry: () => null,
    blacklist: new Map(),
    seenUrls: new Set(),
    seenCompanyRoles: new Set(),
    rejectUrl,
    appendToPipeline: async () => {
      pipelineCalls += 1;
    },
    appendToScanHistory: async () => {
      historyCalls += 1;
    },
  });
  assert.equal(pipelineCalls, 0);
  assert.equal(historyCalls, 0);
  assert.equal(result.added, normalizeIndeedItems(FIXTURE).length);
});

test('sem dry-run escreve uma vez, histórico só depois do pipeline', async () => {
  let pipelineResolved = false;
  let pipelineCalls = 0;
  let historyCalls = 0;
  /** @type {unknown[]|undefined} */
  let written;

  const result = await runIndeedScan({
    dryRun: false,
    fetch: actorFetch(),
    sleep: async () => {},
    now: clock(),
    token: 'apify_api_test_token_value',
    profile: PROFILE,
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
      if (!pipelineResolved) {
        throw new Error('history ran before pipeline resolved');
      }
      historyCalls += 1;
    },
  });

  assert.equal(pipelineCalls, 1);
  assert.equal(historyCalls, 1);
  assert.equal(Array.isArray(written), true);
  assert.equal(written.length, result.added);
  assert.equal(written[0].source, 'scan-indeed');
});

test('falha de uma corrida não impede as outras', async () => {
  let pipelineCalls = 0;
  const logs = [];
  const bodies = [];
  const result = await runIndeedScan({
    dryRun: false,
    fetch: async (url, init = {}) => {
      if (init.method === 'POST') {
        const body = JSON.parse(init.body);
        bodies.push(body);
        if (body.country === 'us') return new Response('boom', { status: 500 });
      }
      return actorFetch()(url, init);
    },
    sleep: async () => {},
    now: clock(),
    token: 'apify_api_test_token_value',
    profile: PROFILE,
    titleFilter: () => true,
    findBlacklistEntry: () => null,
    rejectUrl,
    appendToPipeline: async () => {
      pipelineCalls += 1;
    },
    appendToScanHistory: async () => {},
    log: (line) => logs.push(line),
  });
  assert.equal(result.errors.length, 1);
  assert.equal(pipelineCalls, 1);
  assert.ok(result.added > 0);
  assert.ok(logs.some((line) => line.includes('error')));
  assert.equal(
    bodies.every((body) => body.scanLocation === undefined),
    true,
  );
});

test('redirect para 127.0.0.1 não é seguido', async () => {
  let calls = 0;
  await assert.rejects(() =>
    runActor(
      { query: 'dados', country: 'pt', location: 'Portugal', maxRows: 1 },
      {
        token: 'apify_api_test_token_value',
        sleep: async () => {},
        now: clock(),
        rejectUrl,
        fetch: async () => {
          calls += 1;
          return new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1/' },
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
    { query: 'dados', country: 'pt', location: 'Portugal', maxRows: 1 },
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

test('formatPipelineOffer separa url, empresa e cargo', async (t) => {
  if (!existsSync(join(CAREER_OPS, 'scan.mjs'))) {
    t.skip('career-ops checkout ausente');
    return;
  }
  const { formatPipelineOffer } = await import('../../career-ops/scan.mjs');
  const offer = normalizeIndeedItems(FIXTURE)[0];
  const line = formatPipelineOffer(offer);
  const parts = line.split(' | ');
  assert.ok(parts.length >= 3);
  assert.match(line, /https:\/\/www\.indeed\.com\/viewjob\?jk=abc123/);
  assert.match(line, /Acme/);
  assert.match(line, /Senior Data Engineer/);
});

test('o CLI entrega rejectPrivateOrInvalid ao núcleo', () => {
  const cli = readFileSync(join(HERE, 'scan-indeed.mjs'), 'utf8');
  assert.match(cli, /rejectPrivateOrInvalid/);
  assert.match(cli, /rejectUrl:\s*rejectPrivateOrInvalid/);
  assert.match(cli, /const \{ seen: seenUrls \} = loadSeenUrls\(\)/);
  assert.doesNotMatch(cli, /seenUrls:\s*loadSeenUrls\(\)/);
});
