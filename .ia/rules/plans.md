# Regra — Planos de trabalho (todas as IAs)

**Escopo:** qualquer IA (Claude Code, OpenCode, ou outra) que execute trabalho multi-etapa
neste repositório — orquestradores, features novas, refactors de vários arquivos.

## Regra geral (obrigatória)

1. **Todo plano de trabalho multi-etapa** é escrito em `ia-docs/plans/<feature-em-kebab-case>.plan.md`
   — um arquivo por feature. **Não** crie planos em outra pasta (nem `.claude/`, nem `.opencode/`,
   nem `docs/`).
2. **Antes de retomar trabalho numa feature**, verifique se já existe `ia-docs/plans/<feature>.plan.md`:
   - Se existir, leia o campo **"Próxima ação"** e retome exatamente de lá — não reexecute etapas
     já marcadas como `feita`.
   - Se não existir, crie o plano antes de implementar.
3. **O plano é o único estado durável da orquestração.** Subagents/IA começam com contexto zerado;
   qualquer informação que precise sobreviver entre sessões vai para o `.plan.md` (decisões, status,
   pendências, próxima ação).
4. **Nunca implementar antes da aprovação humana do plano.** A fase de plano é somente leitura
   (análise do código existente, leitura de regras, mapeamento de camadas). Edição em `src/`,
   `tests/` ou qualquer código de produção só começa depois que o usuário aprovar o plano
   explicitamente ("aprovado", "pode seguir", "go"). Isso vale **independentemente do modo de
   permissão da sessão** (plan mode ou não) — é regra do workflow, não da permissão.
5. **Atualize o plano a cada etapa concluída** (status em §4, log em §6, próxima ação em §5).
   Um plano desatualizado é pior que nenhum plano.
6. **Formato:** use o template canônico abaixo. Se o trabalho for menor que 2 etapas (ex.: corrigir
   1 bug), plano opcional — mas se for criado, use o mesmo formato.
7. **Fases do roadmap do Agendabô** (PROMPT.md) são planos pai: cada fase tem um `.plan.md` e
   o fim da fase exige `build+test+lint+lint:arch` verdes + spec/plano atualizados.

## Template canônico do `.plan.md`

```markdown
# Plano — <Feature / Fluxo>

- Data: <AAAA-MM-DD> | Status: planejado | aprovado | em execução | concluído | bloqueado
- Spec: .ia/specs/<domínio>/<feature>.spec.md (se houver) | Fase do roadmap: <n>
- Orquestrador: <nome> | v<n> do plano

## 1. Objetivo

<1-2 frases: o que será entregue e por quê>

## 2. Análise de profundidade

<Resumo da análise read-only: contratos confirmados (de onde vieram), módulos afetados,
exemplos vizinhos usados como referência, gaps>

## 3. Decisões

| #   | Decisão | Alternativa descartada | Por quê |
| --- | ------- | ---------------------- | ------- |
| D1  | ...     | ...                    | ...     |

## 4. Etapas

| #   | Etapa | Worker | Status   | Saída (condição de pronta) | Relatório |
| --- | ----- | ------ | -------- | -------------------------- | --------- |
| 1   | ...   | ...    | pendente | build+lint+test verdes     | —         |

Status permitidos: `pendente` | `em execução` | `feita` | `bloqueada` | `feita com ressalvas`

## 5. Próxima ação

<1 frase objetiva, retomável por qualquer IA sem contexto>

## 6. Log

- <AAAA-MM-DD HH:mm> — <o que mudou / decidiu>
```
