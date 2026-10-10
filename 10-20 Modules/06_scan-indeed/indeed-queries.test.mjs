import test from 'node:test';
import assert from 'node:assert/strict';
import { PT_BR_ROLE_VARIANTS, buildIndeedInputs } from './indeed-queries.mjs';

const PROFILE = {
  target_roles: { primary: ['Senior Data Engineer'] },
};

test('um cargo gera três corridas, com remoto só nos Estados Unidos', () => {
  const inputs = buildIndeedInputs(PROFILE);
  assert.equal(inputs.length, 3);
  assert.deepEqual(
    inputs.map((input) => input.country),
    ['us', 'br', 'pt'],
  );
  assert.equal(inputs[0].location, 'remote');
  assert.equal(inputs[0].remote, 'remote');
  assert.equal(inputs[0].scanLocation, 'Remote');
  assert.equal(inputs[1].location, 'Brazil');
  assert.equal(inputs[1].scanLocation, 'Brazil');
  assert.equal(Object.hasOwn(inputs[1], 'remote'), false);
  assert.equal(inputs[2].location, 'Portugal');
  assert.equal(inputs[2].scanLocation, 'Portugal');
  assert.equal(Object.hasOwn(inputs[2], 'remote'), false);
  assert.match(
    inputs[0].query,
    /Senior Data Engineer OR Engenheiro de Dados Sênior/,
  );
  assert.equal(
    inputs.every((input) => input.query === inputs[0].query),
    true,
  );
  assert.equal(
    inputs.every((input) => input.maxRows === 120),
    true,
  );
  assert.equal(
    inputs.every((input) => input.sort === 'date'),
    true,
  );
  assert.equal(
    inputs.every((input) => input.includeCompanyDetails === false),
    true,
  );
  assert.equal(
    inputs.every((input) => input.enableUniqueJobs === true),
    true,
  );
});

test('test mode usa o primeiro cargo, maxRows 6 e ainda três corridas', () => {
  const inputs = buildIndeedInputs(
    {
      target_roles: {
        primary: ['Senior Data Engineer', 'Head of Data'],
      },
    },
    { testMode: true },
  );
  assert.equal(inputs.length, 3);
  assert.equal(
    inputs.every((input) => input.maxRows === 6),
    true,
  );
  assert.match(inputs[0].query, /Senior Data Engineer/);
  assert.equal(inputs[0].query.includes('Head of Data'), false);
  assert.equal(inputs[0].query.includes('Head de Dados'), false);
});

test('no máximo os seis primeiros cargos do perfil', () => {
  const inputs = buildIndeedInputs({
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
  const query = inputs[0].query;
  assert.match(query, /Data Strategy Lead/);
  assert.match(query, /Líder de Estratégia de Dados/);
  assert.equal(query.includes('VP of Data'), false);
  assert.equal(query.includes('VP de Dados'), false);
});

test('pt_br do perfil entra depois do mapa; cargo desconhecido fica o original', () => {
  const inputs = buildIndeedInputs({
    target_roles: {
      primary: ['Senior Data Engineer', 'Pessoa de Dados'],
      pt_br: {
        'Senior Data Engineer': ['Analista de Dados Pleno'],
      },
    },
  });
  const query = inputs[0].query;
  const mapped = query.indexOf('Engenheiro de Dados Sênior');
  const extra = query.indexOf('Analista de Dados Pleno');
  assert.ok(mapped > 0);
  assert.ok(extra > mapped);
  assert.match(query, /Pessoa de Dados$/);
  assert.equal(query.includes('Pessoa de Dados OR'), false);
});

test('pt-BR é o mesmo mapa extra, e a chave ignora caixa e espaços', () => {
  const inputs = buildIndeedInputs({
    target_roles: {
      primary: ['  SENIOR   data   ENGINEER  '],
      'pt-BR': {
        'senior data engineer': ['Cargo do perfil'],
      },
    },
  });
  const query = inputs[0].query;
  assert.match(query, /Engenheiro de Dados Sênior/);
  assert.match(query, /Cargo do perfil/);
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
