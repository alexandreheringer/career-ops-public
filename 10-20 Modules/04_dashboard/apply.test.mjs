import test from 'node:test';
import assert from 'node:assert/strict';
import { edits } from './edits/index.mjs';
import { editStateFromContent, payloadFingerprints } from './edit-state.mjs';

test('toda edição tem os quatro campos e não é no-op', () => {
  assert.ok(edits.length > 0, 'nenhuma edição registrada');
  for (const edit of edits) {
    for (const field of ['file', 'label', 'anchor', 'replacement']) {
      assert.equal(
        typeof edit[field],
        'string',
        `${edit.label}: ${field} não é string`,
      );
      assert.ok(edit[field].length > 0, `${edit.label}: ${field} vazio`);
    }
    assert.notEqual(
      edit.anchor,
      edit.replacement,
      `${edit.label}: anchor === replacement`,
    );
  }
});

test('todo replacement contém sua anchor — a edição acrescenta, não substitui às cegas', () => {
  const ADDITIVE = edits.filter((e) => !e.rewrite);
  for (const edit of ADDITIVE) {
    assert.ok(
      edit.replacement.includes(edit.anchor),
      `${edit.file} · ${edit.label}: replacement não contém a anchor. Se a linha é reescrita de propósito, ponha rewrite: true na edição.`,
    );
  }
});

test('nenhum replacement usa padrão de substituição de String.replace', () => {
  // `content.replace(anchor, replacement)` interpreta $&, $1, $`, $' no
  // replacement. Uma edição que contivesse isso seria aplicada errada e o
  // sintoma apareceria como erro de compilação do Next, longe da causa.
  for (const edit of edits) {
    assert.doesNotMatch(
      edit.replacement,
      /\$[&`'$0-9]/,
      `${edit.file} · ${edit.label}: replacement tem um padrão $ que String.replace vai interpretar`,
    );
  }
});

test('nenhuma anchor é prefixo de outra no mesmo arquivo', () => {
  // Duas âncoras onde uma contém a outra fazem a ordem de aplicação importar, e
  // ordem implícita é como a segunda edição deixa de encontrar seu alvo.
  const byFile = new Map();
  for (const edit of edits) {
    if (!byFile.has(edit.file)) byFile.set(edit.file, []);
    byFile.get(edit.file).push(edit);
  }
  for (const [file, fileEdits] of byFile) {
    for (const a of fileEdits) {
      for (const b of fileEdits) {
        if (a === b) continue;
        assert.ok(
          !a.anchor.includes(b.anchor),
          `${file}: a anchor de "${a.label}" contém a de "${b.label}"`,
        );
      }
    }
  }
});

test('edição aditiva tem impressão digital — senão um apply depois de mudar o comentário duplica', () => {
  const additive = edits.filter((e) => !e.rewrite);
  assert.ok(additive.length > 0, 'nenhuma edição aditiva para proteger');
  for (const edit of additive) {
    assert.ok(
      payloadFingerprints(edit).length > 0,
      `${edit.file} · ${edit.label}: payload sem linha ≥40 caracteres fora de comentário`,
    );
  }
});

test('import já presente com comentário antigo conta como applied, não ready', () => {
  const edit = edits.find((e) => e.label === 'importar o leitor do índice');
  assert.ok(edit, 'edição do import sumiu');
  const stale = `${edit.anchor}
// Cópia gerada por \`node dashboard/apply.mjs\`; a fonte é dashboard/read-jd-index.mjs.
import { jdIndexPath, readJdReadyUrls } from "@/lib/read-jd-index.mjs";
`;
  assert.equal(editStateFromContent(stale, edit), 'applied');
});

test('tick já presente com comando antigo no title conta como applied', () => {
  const edit = edits.find((e) => e.label === 'tick azul de job description');
  assert.ok(edit, 'edição do tick sumiu');
  const stale = edit.replacement.replace(
    'npm run jd:gather -- --browser',
    'node jd-ready/gather.mjs --browser',
  );
  assert.notEqual(
    stale,
    edit.replacement,
    'fixture precisa divergir do replacement atual',
  );
  assert.equal(editStateFromContent(stale, edit), 'applied');
});
