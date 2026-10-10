const FILE = 'web/src/components/inbox/facet-chips.tsx';

export const facetChipsEdits = [
  {
    file: FILE,
    label: 'props jdOnly (desestruturação)',
    // inserts jdOnly/setJdOnly between toggleSeniority and locQ
    rewrite: true,
    anchor: `  seniorities,
  toggleSeniority,
  locQ,`,
    replacement: `  seniorities,
  toggleSeniority,
  jdOnly,
  setJdOnly,
  locQ,`,
  },
  {
    file: FILE,
    label: 'props jdOnly (tipo)',
    // inserts jdOnly/setJdOnly types between toggleSeniority and locQ
    rewrite: true,
    anchor: `  toggleSeniority: (s: Seniority) => void;
  locQ: string;`,
    replacement: `  toggleSeniority: (s: Seniority) => void;
  jdOnly: boolean;
  setJdOnly: (v: boolean) => void;
  locQ: string;`,
  },
  {
    file: FILE,
    label: 'chip Job Description',
    anchor: `        {availSeniorities.map((s) => (
          <Pill key={s} on={seniorities.has(s)} onClick={() => toggleSeniority(s)}>
            {SENIORITY_LABEL[s]}
          </Pill>
        ))}`,
    replacement: `        {availSeniorities.map((s) => (
          <Pill key={s} on={seniorities.has(s)} onClick={() => toggleSeniority(s)}>
            {SENIORITY_LABEL[s]}
          </Pill>
        ))}

        {/* Filtro, não trava.

            Este chip esconde as vagas sem JD; ele pode estar DESLIGADO e o Save
            continua recusando uma vaga sem JD. São coisas separadas de
            propósito: um filtro que também é trava faz o usuário achar que
            ligar o filtro é o que habilita a avaliação.

            Custa 0 token, como todos os outros chips desta linha. */}
        <Pill on={jdOnly} onClick={() => setJdOnly(!jdOnly)}>
          Job Description
        </Pill>`,
  },
];
