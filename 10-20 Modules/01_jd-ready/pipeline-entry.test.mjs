import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIPELINE_CHECKBOX_RE,
  extractPipelineUrl,
  extractPipelineCompanyRole,
} from './pipeline-entry.mjs';

test('extrai URL das formas de linha que o pipeline realmente carrega', () => {
  // forma do scanner: URL primeiro
  assert.equal(
    extractPipelineUrl(
      '- [ ] https://jobs.ashbyhq.com/acme/1 | Acme | Data Engineer',
    ),
    'https://jobs.ashbyhq.com/acme/1',
  );
  // URL sozinha
  assert.equal(
    extractPipelineUrl('- [ ] https://example.com/job/7'),
    'https://example.com/job/7',
  );
  // processada, com número de report antes da URL
  assert.equal(
    extractPipelineUrl('- [x] #143 | https://example.com/job/7 | Acme | Dev'),
    'https://example.com/job/7',
  );
  // expirada: ainda tem URL
  assert.equal(
    extractPipelineUrl('- [ ] ~~https://example.com/job/9 | Acme | Dev~~'),
    'https://example.com/job/9',
  );
  // não é entrada de pipeline
  assert.equal(
    extractPipelineUrl('Veja https://example.com/job/7 depois'),
    null,
  );
});

test('URL com pipe e com til não é truncada', () => {
  // `|` é o separador de célula e é o único terminador seguro; `~` é legal em URL
  assert.equal(
    extractPipelineUrl('- [ ] https://example.com/~alex/job(sp) | Acme | Dev'),
    'https://example.com/~alex/job(sp)',
  );
});

test('company/role vem das células DEPOIS da URL, não das células 1 e 2', () => {
  const pair = extractPipelineCompanyRole(
    '- [ ] https://x.com/1 | Acme | Data Engineer | Lisboa',
  );
  assert.deepEqual(
    { company: pair.company, role: pair.role, location: pair.location },
    { company: 'Acme', role: 'Data Engineer', location: 'Lisboa' },
  );
});

test('segmento rotulado não é lido como localidade', () => {
  const pair = extractPipelineCompanyRole(
    '- [ ] https://x.com/1 | Acme | Dev | note: via teal',
  );
  assert.equal(pair.location, '');
});

test('entrada expirada e descarte de pré-triagem não contribuem par', () => {
  assert.equal(
    extractPipelineCompanyRole('- [ ] ~~https://x.com/1 | Acme | Dev~~'),
    null,
  );
  assert.equal(
    extractPipelineCompanyRole('- [ ] #-- | https://x.com/1 | skipped (title)'),
    null,
  );
});

test('o regex de checkbox aceita espaço e x, e tolera indentação', () => {
  assert.equal(PIPELINE_CHECKBOX_RE.test('- [ ] https://x.com/1'), true);
  assert.equal(PIPELINE_CHECKBOX_RE.test('  - [x] https://x.com/1'), true);
  // `- [!]` é "não deu para buscar", não é evidência de vaga vista
  assert.equal(PIPELINE_CHECKBOX_RE.test('- [!] https://x.com/1'), false);
});
