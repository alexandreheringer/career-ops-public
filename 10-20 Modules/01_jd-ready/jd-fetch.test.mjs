import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jdFileName,
  formatJdFile,
  looksLikeLoginWall,
  isLinkedIn,
  stripHtml,
} from './jd-fetch.mjs';

test('jdFileName é determinístico: a mesma URL sempre dá o mesmo arquivo', () => {
  const url = 'https://jobs.ashbyhq.com/acme/275f43d0';
  const a = jdFileName({
    url,
    company: 'Acme Corp',
    role: 'Senior Data Engineer',
  });
  const b = jdFileName({
    url,
    company: 'Acme Corp',
    role: 'Senior Data Engineer',
  });
  assert.equal(a, b);
  assert.match(a, /^acme-corp-senior-data-engineer-[0-9a-f]{8}\.md$/);
});

test('jdFileName distingue duas vagas da mesma empresa com o mesmo cargo', () => {
  const base = { company: 'Acme', role: 'Data Engineer' };
  const a = jdFileName({ ...base, url: 'https://x.com/sp' });
  const b = jdFileName({ ...base, url: 'https://x.com/ny' });
  assert.notEqual(a, b);
});

test('jdFileName sobrevive a acento, barra, espaço e cargo vazio', () => {
  const name = jdFileName({
    url: 'https://x.com/1',
    company: 'Nortal / Brasil',
    role: 'Coordenador(a) de Operações',
  });
  assert.match(
    name,
    /^nortal-brasil-coordenador-a-de-operacoes-[0-9a-f]{8}\.md$/,
  );
  // sem empresa nem cargo ainda produz um nome válido — nunca `.md` solto
  assert.match(
    jdFileName({ url: 'https://x.com/1', company: '', role: '' }),
    /^vaga-[0-9a-f]{8}\.md$/,
  );
});

test('formatJdFile preserva o texto e anexa a URL de origem', () => {
  const out = formatJdFile({
    text: 'Descrição da vaga.',
    url: 'https://x.com/1',
  });
  assert.match(
    out,
    /^Descrição da vaga\.\n\n---\nSource: https:\/\/x\.com\/1\n$/,
  );
});

test('looksLikeLoginWall pega as frases que o LinkedIn devolve', () => {
  assert.equal(looksLikeLoginWall('Sign in to view this job'), true);
  assert.equal(looksLikeLoginWall('Join LinkedIn to see who you know'), true);
  assert.equal(looksLikeLoginWall('Faça login para continuar'), true);
  assert.equal(looksLikeLoginWall('Cadastre-se para ver a vaga'), true);
  assert.equal(
    looksLikeLoginWall(
      'We are hiring a Senior Data Engineer to sign off on data contracts',
    ),
    false,
  );
});

test('isLinkedIn casa no domínio registrável, não em substring', () => {
  assert.equal(isLinkedIn('https://www.linkedin.com/jobs/view/1'), true);
  assert.equal(isLinkedIn('https://br.linkedin.com/jobs/view/1'), true);
  assert.equal(isLinkedIn('https://linkedin.com.evil.net/jobs/1'), false);
  assert.equal(isLinkedIn('https://notlinkedin.com/jobs/1'), false);
  assert.equal(isLinkedIn('nao-e-url'), false);
});

test('stripHtml remove script, style e tags, e desfaz as entidades comuns', () => {
  const html =
    '<html><head><style>b{}</style><script>var x=1</script></head>' +
    '<body><h1>Data&nbsp;Engineer</h1><p>R&amp;D &lt;team&gt;</p></body></html>';
  const text = stripHtml(html);
  assert.equal(text.includes('var x=1'), false);
  assert.equal(text.includes('b{}'), false);
  assert.match(text, /Data Engineer/);
  assert.match(text, /R&D <team>/);
});
