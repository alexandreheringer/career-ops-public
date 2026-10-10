import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTargetLocation } from './location-allow.mjs';
import { normalizeLinkedInItems } from './linkedin-normalize.mjs';
import {
  runActor,
  runLinkedInScan,
  selectOffers,
} from './linkedin-scan-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAREER_OPS = join(HERE, '..', '..', 'career-ops');
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, 'fixtures/linkedin-items.json'), 'utf8'),
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

function actorFetch(items = FIXTURE) {
  return async (url, init = {}) => {
    const target = String(url);
    if (init.redirect && init.redirect !== 'manual') {
      throw new Error(`redirect must be manual, got ${init.redirect}`);
    }
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      return jsonResponse({
        data: {
          id: `run-${body.location}`,
          defaultDatasetId: `ds-${body.location}`,
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

test('Portugal passa e Argentina fica fora', () => {
  assert.equal(isTargetLocation('Portugal'), true);
  assert.equal(isTargetLocation('Argentina'), false);
});

test('selectOffers descarta URL privada', () => {
  const { offers } = selectOffers(
    [
      {
        title: 'Senior Data Engineer',
        url: 'http://169.254.169.254/',
        company: 'Acme',
        location: 'Portugal',
        source: 'scan-linkedin',
      },
      {
        title: 'Senior Data Engineer',
        url: 'https://www.linkedin.com/jobs/view/123',
        company: 'Acme',
        location: 'Portugal',
        source: 'scan-linkedin',
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
    ['https://www.linkedin.com/jobs/view/123'],
  );
});

test('perfil sem cargo não chama a rede', async () => {
  let calls = 0;
  const result = await runLinkedInScan({
    profile: {},
    fetch: async () => {
      calls += 1;
      throw new Error('não deveria chamar a rede');
    },
    token: 'apify_api_test_token_value',
    rejectUrl,
  });
  assert.equal(calls, 0);
  assert.equal(result.added, 0);
});

test('dry-run não escreve', async () => {
  let pipelineCalls = 0;
  let historyCalls = 0;
  const result = await runLinkedInScan({
    dryRun: true,
    fetch: actorFetch(),
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
    appendToScanHistory: async () => {
      historyCalls += 1;
    },
  });
  assert.equal(pipelineCalls, 0);
  assert.equal(historyCalls, 0);
  assert.equal(result.added, normalizeLinkedInItems(FIXTURE).length);
});

test('sem dry-run escreve uma vez, histórico só depois do pipeline', async () => {
  let pipelineResolved = false;
  let pipelineCalls = 0;
  let historyCalls = 0;

  const result = await runLinkedInScan({
    dryRun: false,
    fetch: actorFetch(),
    sleep: async () => {},
    now: clock(),
    token: 'apify_api_test_token_value',
    profile: PROFILE,
    titleFilter: () => true,
    findBlacklistEntry: () => null,
    rejectUrl,
    appendToPipeline: async () => {
      pipelineCalls += 1;
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
  assert.equal(result.added, 1);
});

test('falha de uma corrida não impede as outras', async () => {
  const logs = [];
  const result = await runLinkedInScan({
    dryRun: true,
    fetch: async (url, init = {}) => {
      if (init.method === 'POST') {
        const body = JSON.parse(init.body);
        if (body.location === 'Remote') {
          return new Response('boom', { status: 500 });
        }
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
    log: (line) => logs.push(line),
  });
  assert.equal(result.errors.length, 1);
  assert.ok(result.added > 0);
  assert.ok(logs.some((line) => line.includes('error')));
});

test('redirect para host que não é api.apify.com não é seguido', async () => {
  let calls = 0;
  await assert.rejects(() =>
    runActor(
      { keyword: 'dados', location: 'Portugal', maxResults: 1 },
      {
        token: 'apify_api_test_token_value',
        sleep: async () => {},
        now: clock(),
        rejectUrl,
        fetch: async () => {
          calls += 1;
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil.example/run' },
          });
        },
      },
    ),
  );
  assert.equal(calls, 1);
});

test('formatPipelineOffer inclui url, empresa, cargo e posted', async (t) => {
  if (!existsSync(join(CAREER_OPS, 'scan.mjs'))) {
    t.skip('career-ops checkout ausente');
    return;
  }
  const { formatPipelineOffer } = await import('../../career-ops/scan.mjs');
  const offer = normalizeLinkedInItems(FIXTURE)[0];
  const line = formatPipelineOffer(offer);
  assert.match(line, /https:\/\/www\.linkedin\.com\/jobs\/view\/123/);
  assert.match(line, /Acme/);
  assert.match(line, /Senior Data Engineer/);
  assert.match(line, /posted: 2026-05-01/);
  assert.ok(line.split(' | ').length >= 3);
});

test('o CLI entrega rejectPrivateOrInvalid ao núcleo', () => {
  const cli = readFileSync(join(HERE, 'scan-linkedin.mjs'), 'utf8');
  assert.match(cli, /rejectPrivateOrInvalid/);
  assert.match(cli, /rejectUrl:\s*rejectPrivateOrInvalid/);
  assert.match(cli, /const \{ seen: seenUrls \} = loadSeenUrls\(\)/);
  assert.doesNotMatch(cli, /seenUrls:\s*loadSeenUrls\(\)/);
});
