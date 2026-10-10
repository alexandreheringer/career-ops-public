import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jdIndexPath, readJdReadyUrls } from './read-jd-index.mjs';

test('jdIndexPath sobe um nível do career-ops e acha 10-20 Modules/01_jd-ready/', () => {
  const resolved = jdIndexPath('/proj/career-ops', {});
  assert.equal(
    resolved,
    path.join('/proj', '10-20 Modules', '01_jd-ready', 'jd-ready.tsv'),
  );
});

test('CAREER_OPS_JD_INDEX tem precedência', () => {
  assert.equal(
    jdIndexPath('/proj/career-ops', { CAREER_OPS_JD_INDEX: '/outro/i.tsv' }),
    '/outro/i.tsv',
  );
});

test('índice ausente devolve conjunto vazio, não erro', () => {
  assert.equal(
    readJdReadyUrls(
      path.join(mkdtempSync(path.join(tmpdir(), 'jdi-')), 'nada.tsv'),
    ).size,
    0,
  );
});

test('só as linhas ready entram no conjunto', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jdi-'));
  const p = path.join(dir, 'jd-ready.tsv');
  writeFileSync(
    p,
    [
      'url\tstatus\tjd_path\tchars\tupdated',
      'https://x.com/1\tready\tjds/a.md\t900\t2026-10-01',
      'https://x.com/2\tmissing\t\t0\t2026-10-01',
      'https://x.com/3\tready\tjds/c.md\t4000\t2026-10-01',
      '',
    ].join('\n'),
  );

  const ready = readJdReadyUrls(p);
  assert.deepEqual([...ready].sort(), ['https://x.com/1', 'https://x.com/3']);
  assert.equal(ready.has('https://x.com/2'), false);
});
