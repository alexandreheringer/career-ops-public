# ESLint, Prettier, Husky e GitHub Actions — o que é e por que este repo usa

Este texto é o tutorial. O plano de instalação está em
[`06-eslint-ci.md`](../../90-99%20Archive/91%20implemented%20plans/06-eslint-ci.md).
As ferramentas **já estão no disco**: `npm run verify` no Mac, Husky no
`git push`, Actions em todo push e PR.

O plano 06 existe para você implementar os **outros** planos (03–05). Cada
um é um módulo. No Mac você lint, formata e testa esse módulo. No GitHub
o Actions repete as três provas num clone que **não** tem `career-ops/`.

---

## O problema que isso resolve

Você (ou um agente) altera um `.mjs`, faz commit, faz push, abre PR. Sem
nenhuma trava:

- um `import` esquecido, uma variável morta, aspas misturadas
  só aparecem quando alguém lê o código;
- a [PR #1](https://github.com/alexandreheringer/21.15-New-Career-Ops/pull/1)
  deste repo **não teve nenhum check**. O GitHub não rodou teste nem lint.
  “Mergeable” só queria dizer “não há conflito de git”, não “o código está
  ok”.

Não faz sentido dar push com código ruim. Duas travas cobrem dois
momentos. Elas não se substituem.

```text
você edita o módulo (jd-ready, search-teal, …)
        │
        ▼
   npm run lint / format / test     ← você, enquanto implementa
   npm run verify                   ← as três de uma vez
        │
        ▼
   git push
        │
        ├─ Husky (pre-push, no Mac)
        │     verify falhou → o push NEM SAI da máquina
        │     verify ok     → o GitHub recebe os commits
        │
        └─ GitHub Actions (depois, na nuvem)
              lint, format:check ou teste falhou → check vermelho na PR
              os três ok                         → check verde
```

| Ferramenta | Onde roda | Quando | Se falhar |
|---|---|---|---|
| ESLint (`npm run lint`) | Mac, quando você mandar | Enquanto implementa o módulo | Só imprime erros; não impede o git |
| Prettier (`npm run format`) | Mac, quando você mandar | Enquanto implementa o módulo | Reescreve o arquivo; não impede o git |
| `npm run verify` | Mac, quando você mandar | Lint + `format:check` + testes | Exit ≠ 0; não impede o git sozinho |
| Husky | Mac, no `git push` | Sempre que você der push | O push é abortado (`verify` falhou) |
| GitHub Actions | Servidor do GitHub | Todo push e toda PR | O código **já está** no remoto; a PR fica vermelha |

---

## ESLint — o revisor de erro

O ESLint **lê** o JavaScript e aplica regras. Não executa o programa. Não
substitui `npm test`. Não formata (isso é Prettier).

Exemplos do que a regra `recommended` pega:

- variável ou `import` declarado e nunca usado;
- código depois de um `return`;
- atribuição acidental dentro de um `if` (`if (x = 1)`).

O que **não** pega: “essa função está errada para o negócio”, “faltou um
teste”, “aspas simples vs duplas”. Negócio é teste. Estética é Prettier.

Neste projeto o alvo é o JavaScript **deste** git: `10-20 Modules/` e a
raiz (`career-ops-root.mjs`). **Não** lintamos `career-ops/`: é outro
repositório, gitignorado, atualizado pelo upstream.

Config moderna (ESLint 9) é `eslint.config.js` na raiz. O comando:

```bash
npm run lint       # aponta os erros
npm run lint:fix   # corrige só o que for mecânico e não-estético
```

Se o lint reclamar de um `import` não usado, o conserto certo é **apagar o
import**, não desligar a regra.

---

## Prettier — o formatador

O Prettier **reescreve** o arquivo para um estilo só (aspas, quebras,
vírgula final). Não acha bug. Não substitui o ESLint.

Neste repo ele só olha `**/*.{mjs,js}` — os módulos. Não formata os
`.md` de planos (um `prettier .` geraria um diff de 800 linhas alheio ao
módulo). Não formata `career-ops/`.

O estilo bate com o código que já existe: aspas simples, vírgula final
em multilinha (`singleQuote`, `trailingComma: all`).

```bash
npm run format         # reescreve
npm run format:check   # só diz se está fora do estilo (é o que a trava usa)
```

As travas **não** auto-formatam. Se `format:check` falhar, você roda
`format`, commita, tenta de novo. Validar não é mutar no meio do push.

`eslint-config-prettier` entra por último no `eslint.config.js` para o
ESLint não brigar com o Prettier por ponto e vírgula.

---

## Testes — a prova do módulo

`npm test` cobre os globs em `10-20 Modules/**/*.test.mjs` via
`package.json`; o `verify` e o Actions herdam.

Uma diferença entre Mac e GitHub: o Mac tem `career-ops/` no disco; o
Actions não (a pasta é gitignorada). Os testes que o CI roda têm de
carregar sem esse checkout. Por isso `jd-fetch.mjs` e o CLI do `gather`
não importam o upstream no topo do módulo.

---

## O comando único

```bash
npm run verify    # lint && format:check && test
```

É o que você roda no Mac quando o módulo “está pronto para subir”. É o
que o Husky roda no `git push`. No Actions as três provas são steps
separados, para o log da PR nomear qual quebrou.

---

## Husky — o alarme no seu Mac

O Git tem “ganchos”: scripts que rodam em eventos (`commit`, `push`, …).
Eles moram em `.git/hooks/`, que **não é commitado**. Sem ferramenta, cada
clone teria que copiar os hooks à mão.

O Husky versiona os ganchos em `.husky/` (isso **entra no git**). No
`package.json` fica `"prepare": "husky"`. O `npm install` instala o gancho
na sua cópia do `.git`. Sem `npm install`, o Husky não existe naquela
máquina.

Neste plano o gancho é **`pre-push`**, não `pre-commit`:

- os planos 02–05 fazem commits pequenos e frequentes;
- “não faz sentido dar push com código ruim” — a trava é o push.

`.husky/pre-push` roda `npm run verify`.

### `git push --no-verify`

Pula o Husky. Use quando o verify está quebrado de propósito (hotfix
absurdo, WIP num branch que você assume). Não use como hábito: o Actions
ainda vai falhar na PR, e você só adiou o conserto.

Quem clonar o repo e não instalar deps não tem Husky. O Actions ainda
cobre essa pessoa.

---

## GitHub Actions — o robô no GitHub

Um workflow é um YAML em `.github/workflows/`. O GitHub lê esse arquivo e,
nos eventos que você listar, sobe uma máquina Ubuntu, clona o repo, e
roda comandos.

O workflow deste plano dispara em:

- **`push`** — qualquer `git push` (incluindo o merge na `main`);
- **`pull_request`** — abrir ou atualizar uma PR.

Um job, em ordem: `npm ci` → `npm run lint` → `npm run format:check` →
`npm test`. Se o lint falhar, o resto nem roda.

O Husky na Action não deve instalar gancho: o workflow exporta
`HUSKY=0` no `npm ci`. Ninguém dá `git push` dentro da máquina do GitHub.

### Como ler um check vermelho

1. Abra a PR no GitHub.
2. Embaixo dos arquivos, a caixa “Checks” / “Some checks were not successful”.
3. Clique no job `verify`.
4. Expanda o step que falhou (`lint`, `format:check` ou `test`).
5. O log traz `arquivo:linha` — o mesmo que o comando no Mac.
6. Conserte localmente, `npm run verify`, commit, push. O check roda de novo.

Verde não significa “o produto está certo”. Significa: lint, estilo e a
suíte `node --test` passaram neste clone limpo.

---

## Dia a dia, enquanto implementa um plano (03, 04, 05…)

1. Escreve o módulo.
2. `npm run lint` e `npm run format` quando quiser ver o erro cedo.
3. `npm test` no glob daquele módulo (ou `npm test` inteiro).
4. `npm run verify` quando for subir.
5. `git push` — o Husky roda o verify; se falhar, conserta e tenta de novo.
6. Na PR, espera o check `verify`.

---

## O que este plano não instala (e por quê)

| Coisa | Por que não agora |
|---|---|
| `pre-commit` do Husky | Os planos fazem commit pequeno e frequente. A trava pedida é o push. |
| Auto-format no gancho | Validar não é mutar. `format:check` falha; você roda `format` e commita. |
| Prettier em `.md` / `.yml` | Reformatar planos gera diff de plano, não de módulo. |
| Lint/format de `career-ops/` | Outro git, outro dono. Um `update-system` apagaria o nosso gosto. |
| Lint/format de `70-79-automation/` | Legado. Os planos 03 e 04 viram ponteiro. |
| Clonar `career-ops` no Actions | O CI é um clone limpo **deste** git. Os testes têm de carregar sem o upstream. |
| Branch protection (“exigir check verde”) | Botão em GitHub → Settings → Branches. Não é arquivo. Vale ligar depois que o workflow existir, senão a `main` fica travada sem check. |

---

## Analogia curta

- **ESLint** é a lista de checagem (cinto, farol, pneu).
- **Prettier** é o alinhamento das rodas (o carro anda sem, mas cada um
  deixa de um jeito).
- **Teste** é ligar o motor.
- **Husky** é o portão da garagem: sem as três ok, o carro não sai.
- **Actions** é a vistoria na estrada: mesmo que você tenha saído, um
  fiscal independente repete as três.
