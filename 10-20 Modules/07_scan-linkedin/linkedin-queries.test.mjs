import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PT_BR_ROLE_VARIANTS,
  buildLinkedInInputs,
} from './linkedin-queries.mjs';

const PROFILE = {
  target_roles: { primary: ['Senior Data Engineer'] },
};

test('um cargo gera três localizações com a mesma keyword', () => {
  const inputs = buildLinkedInInputs(PROFILE);
  assert.equal(inputs.length, 3);
  assert.deepEqual(
    inputs.map((input) => input.location),
    ['Remote', 'Brazil', 'Portugal'],
  );
  assert.match(inputs[0].keyword, /Engenheiro de Dados Sênior/);
  assert.match(inputs[0].keyword, / OR /);
  assert.equal(
    inputs.every((input) => input.keyword === inputs[0].keyword),
    true,
  );
  assert.equal(
    inputs.every((input) => input.maxResults === 100),
    true,
  );
});

test('test mode usa um cargo, maxResults 5 e ainda três corridas', () => {
  const inputs = buildLinkedInInputs(
    {
      target_roles: {
        primary: ['Senior Data Engineer', 'Head of Data'],
      },
    },
    { testMode: true },
  );
  assert.equal(inputs.length, 3);
  assert.equal(
    inputs.every((input) => input.maxResults === 5),
    true,
  );
  assert.match(inputs[0].keyword, /Senior Data Engineer/);
  assert.equal(inputs[0].keyword.includes('Head of Data'), false);
});

test('perfil sem cargo não produz corrida', () => {
  assert.deepEqual(buildLinkedInInputs({}), []);
  assert.deepEqual(buildLinkedInInputs({ target_roles: { primary: [] } }), []);
});

test('no máximo os seis primeiros cargos do perfil', () => {
  const inputs = buildLinkedInInputs({
    target_roles: {
      primary: [
        'Senior Data Engineer',
        'Head of Data',
        'Tech Lead',
        'Data Architect',
        'Analytics Lead',
        'Data Strategy Lead',
        'VP of Data',
      ],
    },
  });
  const keyword = inputs[0].keyword;
  assert.match(keyword, /Data Strategy Lead/);
  assert.equal(keyword.includes('VP of Data'), false);
});

test('pt_br do perfil entra na keyword', () => {
  const inputs = buildLinkedInInputs({
    target_roles: {
      primary: ['Senior Data Engineer'],
      pt_br: { 'Senior Data Engineer': ['Analista de Dados Pleno'] },
    },
  });
  const keyword = inputs[0].keyword;
  const mapped = keyword.indexOf('Engenheiro de Dados Sênior');
  const extra = keyword.indexOf('Analista de Dados Pleno');
  assert.ok(mapped > 0);
  assert.ok(extra > mapped);
});

test('o mapa congelado guarda os três cargos da revisão', () => {
  assert.deepEqual(PT_BR_ROLE_VARIANTS['senior data engineer'], [
    'Engenheiro de Dados Sênior',
    'Engenheiro Sênior de Dados',
    'Especialista em Engenharia de Dados',
  ]);
  assert.deepEqual(PT_BR_ROLE_VARIANTS['tech lead'], [
    'Tech Lead de Dados',
    'Líder Técnico de Dados',
    'Tech Lead Data',
  ]);
  assert.deepEqual(PT_BR_ROLE_VARIANTS['head of data'], [
    'Head de Dados',
    'Diretor de Dados',
    'Gerente de Dados',
  ]);
});
