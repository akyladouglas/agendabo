#!/usr/bin/env node
/**
 * sync-ia.js — "build" da biblioteca canônica de IA (.ia/) para os harnesses.
 *
 * Fonte única: .ia/  →  Pontas (não versionadas): .claude/agents, .opencode/agents,
 *                        .agents/skills, .claude/skills  +  CLAUDE.md (espelho do AGENTS.md)
 *
 * Uso:
 *   npm run sync:ia                # sincroniza
 *   npm run sync:ia -- --dry-run   # mostra o que mudaria, sem escrever
 *
 * Regras:
 *   - Idempotente: rodar N vezes dá o mesmo resultado.
 *   - Pontas syncadas começam com um comentário de geração (não editar).
 *   - Não apaga arquivos de destino que não gere (avisa se encontrar resíduos).
 *   - Falha com mensagem clara se faltar arquivo canônico esperado.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  cpSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')

const log = (msg) => console.log(msg)
const ok = (msg) => console.log(`\x1b[32m✔\x1b[0m ${msg}`)
const warn = (msg) => console.log(`\x1b[33m⚠\x1b[0m ${msg}`)
const fail = (msg) => {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`)
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const read = (p) => {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) fail(`Arquivo canônico não encontrado: ${p}`)
  // Normaliza BOM: remove o U+FEFF do início (se presente) para que a regex de
  // remoção de frontmatter (^---\n) casie corretamente — sem isso, o BOM faz o
  // frontmatter original ser colado no corpo gerado (corrompe o frontmatter OpenCode).
  const content = readFileSync(abs, 'utf8')
  return content.replace(/^\uFEFF/, '')
}

const write = (p, content) => {
  const abs = join(ROOT, p)
  if (DRY) {
    const exists = existsSync(abs)
    if (exists) {
      const old = readFileSync(abs, 'utf8')
      console.log(
        `\x1b[90m~ (dry-run)\x1b[0m ${p} ${old === content ? '(sem mudanças)' : '(seria atualizado)'}`
      )
    } else {
      console.log(`\x1b[90m+ (dry-run)\x1b[0m ${p} (seria criado)`)
    }
    return
  }
  mkdirSync(join(ROOT, p, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

/** Remove um bloco `<!-- @tag:begin --> ... <!-- @tag:end -->` do texto. */
const stripBlock = (text, tag) => {
  const re = new RegExp(
    `\\n?<!-- @${tag}:begin -->[\\s\\S]*?<!-- @${tag}:end -->\\n?`,
    'g'
  )
  return text.replace(re, '\n')
}

/** Extrai o conteúdo entre `<!-- @tag:begin -->` e `<!-- @tag:end -->` (incluindo as tags). */
const extractBlock = (text, tag) => {
  const re = new RegExp(
    `(\\n?)<!-- @${tag}:begin -->[\\s\\S]*?<!-- @${tag}:end -->`
  )
  const m = text.match(re)
  return m ? m[1] + m[0] : null
}

/**
 * Normaliza o texto de um agente para o harness:
 *  - workers: remove os blocos de orquestrador (não se aplicam);
 *  - orquestradores: mantém somente o bloco do harness e remove o outro.
 */
const normalizeForHarness = (text, harness, isOrchestrator) => {
  let out = text
  if (isOrchestrator) {
    const keep = extractBlock(out, harness)
    if (!keep) fail(`Bloco @${harness} não encontrado no orquestrador`)
    out = out.replace(keep, keep)
    const other = harness === 'claude' ? 'opencode' : 'claude'
    out = stripBlock(out, other)
  } else {
    out = stripBlock(out, 'claude')
    out = stripBlock(out, 'opencode')
  }
  // colapsa 3+ quebras de linha consecutivas no final do texto
  return out.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/**
 * Reescreve referências de caminho no CORPO (após o frontmatter) para o harness.
 * O canônico já usa .ia/...; aqui só tratamos referências que ainda apontam para
 * caminhos de harness específicos (defensivo — o canônico já deve estar limpo).
 */
const rewriteBodyPaths = (text) => {
  // sem transformações necessárias: o canônico já aponta para .ia/
  // (mantido como gancho caso futuramente um harness precise de caminho próprio)
  return text
}

/**
 * Extrai o campo `description` do frontmatter YAML e devolve em **uma única linha**.
 * Suporta: scalar simples, scalar com aspas, e bloco YAML (`>` ou `|` com linhas indentadas).
 */
const extractDescription = (text) => {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^description:\s*/.test(l))
  if (start === -1) return null
  const first = lines[start].replace(/^description:\s*/, '')
  // scalar simples (com ou sem aspas)
  if (first && !/^[>|]/.test(first)) {
    return first
      .replace(/^["']|["']$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  // bloco YAML: coleta linhas subsequente com indentação
  const block = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break // próxima chave de nível 0
    block.push(lines[i].trim())
  }
  return block.join(' ').replace(/\s+/g, ' ').trim()
}

/* Ferramentas do frontmatter canônico → permissões OpenCode (v2).
 * O OpenCode v2 NÃO aceita a chave `tools` como string ("Read, Edit, ...") em
 * agent .md — o schema só aceita `tools` como map { nome: true/false } e a
 * forma recomendada é `permission` (objeto). Strings caem em `options` e o
 * agent perde o restrito de ferramentas (e, pior, quebra o parse do
 * frontmatter quando o parser YAML encontra a linha como valor inválido). */
const TOOL_TO_PERMISSION = {
  Read: 'read',
  Grep: 'grep',
  Glob: 'glob',
  Bash: 'bash',
  Edit: 'edit',
  Write: 'edit',
}

/** Extrai a linha `tools: X, Y, Z` do frontmatter canônico (padrão Claude Code). */
const extractTools = (raw) => {
  const m = raw.match(/^tools:\s*([^\n]+)/m)
  if (!m) return []
  return m[1]
    .split(',')
    .map((t) => t.trim())
    .filter((t) => TOOL_TO_PERMISSION[t])
}

/** Gera o frontmatter OpenCode para um worker.
 * IMPORTANTE: o frontmatter DEVE começar na primeira linha do arquivo (sem
 * comentário antes) — o OpenCode v2 quebra o parse do frontmatter se houver
 * qualquer conteúdo antes do `---`, e o `mode: subagent` é ignorado (o agent
 * vira `primary` e não pode ser invocado via Task).
 *
 * A chave `permission` aceita apenas valores SIMPLES (`allow`/`deny`/`ask`)
 * neste build — object de paths (`read: { "path": allow }`) quebra o parse
 * do frontmatter e faz o agent virar `primary`. Para acesso a paths externos
 * (legado/backend), o usuário pode usar `external_directory` na config global
 * ou aprovar o prompt `ask` quando o worker tentar ler. */
const openCodeWorkerFrontmatter = (description, raw) => {
  const perms = extractTools(raw).map((t) => TOOL_TO_PERMISSION[t])
  const seen = new Set()
  const uniq = perms.filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
  const lines = uniq.map((p) => `  ${p}: allow`)
  return `---\ndescription: ${description}\nmode: subagent\npermission:\n${lines.join('\n')}\n---\n`
}

/** Gera o frontmatter OpenCode para um orquestrador (com permissões).
 * Mesma regra do worker: frontmatter na primeira linha, sem comentário antes.
 * `permission` aceita apenas valores simples — objects de paths quebram o parse. */
const openCodeOrchestratorFrontmatter = (description, workers) => {
  // task: allowlist dos workers (deny por padrão, allow por worker)
  const taskLines = ['  task:']
  taskLines.push('    "*": deny')
  for (const w of workers) taskLines.push(`    "${w}": allow`)
  return (
    `---\ndescription: ${description}\nmode: all\npermission:\n` +
    taskLines.join('\n') +
    '\n  edit:' +
    '\n    "src/**": deny' +
    '\n    "tests/**": deny' +
    '\n    "ia-docs/plans/**": allow' +
    '\n    "ia/specs/**": allow' +
    '\n  bash: allow' +
    '\n  read: allow' +
    '\n  webfetch: allow' +
    '\n  websearch: allow' +
    '\n---\n'
  )
}

/** Gera o frontmatter Claude para um orquestrador (tools com allowlist de Agent). */
const claudeOrchestratorFrontmatter = (name, description, tools, workers) => {
  const agentList = workers.join(', ')
  const toolsLine = `tools: Agent(${agentList}), ${tools}`
  return `---\nname: ${name}\ndescription: ${description}\n${toolsLine}\n---\n`
}

const banner = (src, dest, n) =>
  ok(`${src} → ${dest} (${n} arquivo${n > 1 ? 's' : ''})`)

/* ------------------------------------------------------------------ */
/* 1. Agents (workers)                                                 */
/* ------------------------------------------------------------------ */

const syncWorkers = () => {
  const dir = join(ROOT, '.ia', 'agents')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
  if (files.length === 0) fail('.ia/agents/ está vazio')

  const claudeOut = []
  const opencodeOut = []

  for (const file of files) {
    const raw = read(join('.ia', 'agents', file))

    // description: pode ser scalar (uma linha) ou bloco YAML (`>` / `|`); reconstrói em 1 linha
    const description =
      extractDescription(raw) || `Agente ${file.replace(/\.md$/, '')}`

    const body = normalizeForHarness(raw, 'neutral', false)
    const bodyFinal = rewriteBodyPaths(body)

    // Claude: idêntico ao canônico (frontmatter já tem name/description/tools)
    claudeOut.push({
      file,
      content:
        `<!-- gerado por sync-ia.js a partir de .ia/agents/${file} — não edite -->\n` +
        raw.trimEnd() +
        '\n',
    })

    // OpenCode: frontmatter adaptado (DEVE começar na primeira linha — sem
    // comentário antes, senão o parse do frontmatter quebra e o agent vira
    // `mode: primary`). `tools:` do canônico vira `permission:` (o OpenCode v2
    // não aceita `tools` como string).
    const ocFront = openCodeWorkerFrontmatter(description, raw)
    // Remove o frontmatter original do canônico (com name/description/tools) —
    // a regex precisa aceitar CRLF (o canônico usa CRLF) e o frontmatter pode
    // conter `---` em bloco YAML (description multi-linha) — usa non-greedy até
    // a próxima linha que é só `---`.
    const ocBody = bodyFinal.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    opencodeOut.push({
      file,
      content:
        ocFront +
        ocBody +
        `\n<!-- gerado por sync-ia.js a partir de .ia/agents/${file} — não edite -->\n`,
    })
  }

  for (const { file, content } of claudeOut)
    write(join('.claude', 'agents', file), content)
  for (const { file, content } of opencodeOut)
    write(join('.opencode', 'agents', file), content)
  banner('.ia/agents', '.claude/agents', claudeOut.length)
  banner('.ia/agents', '.opencode/agents', opencodeOut.length)
}

/* ------------------------------------------------------------------ */
/* 2. Orchestrators                                                    */
/* ------------------------------------------------------------------ */

const ORCH_WORKERS = {
  'feature-orchestrator': [
    'spec-writer',
    'feature-builder',
    'bot-flow-builder',
    'test-writer',
    'code-reviewer',
    'unit-test-code-reviewer',
  ],
  'refactor-orchestrator': [
    'feature-builder',
    'test-writer',
    'code-reviewer',
    'unit-test-code-reviewer',
  ],
  'review-orchestrator': [
    'review-arquitetura',
    'review-performance',
    'review-testes',
    'review-seguranca',
    'review-acessibilidade',
    'review-documentacao',
    'review-bot-llm',
    'code-reviewer',
  ],
}

const syncOrchestrators = () => {
  const dir = join(ROOT, '.ia', 'orchestrators')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
  if (files.length === 0) fail('.ia/orchestrators/ está vazio')

  for (const file of files) {
    const name = file.replace(/\.md$/, '')
    const raw = read(join('.ia', 'orchestrators', file))
    const workers = ORCH_WORKERS[name]
    if (!workers)
      fail(`Orquestrador "${name}" sem allowlist em ORCH_WORKERS (sync-ia.js)`)

    const description = extractDescription(raw) || `Orquestrador ${name}`

    // Claude: frontmatter com tools (Agent allowlist + tools de leitura/execução) + bloco @claude
    // Read/Grep/Glob/Bash: análise do legado, busca de arquivos, rodar build/lint para validar saída
    // Write/Edit: criar e atualizar o .plan.md (a única superfície de escrita do orquestrador)
    const claudeTools = 'Read, Grep, Glob, Bash, Write, Edit'
    const claudeBody = normalizeForHarness(raw, 'claude', true)
    const claudeContent =
      `<!-- gerado por sync-ia.js a partir de .ia/orchestrators/${file} — não edite -->\n` +
      claudeOrchestratorFrontmatter(name, description, claudeTools, workers) +
      claudeBody.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')

    // OpenCode: frontmatter com permissions + bloco @opencode
    // (frontmatter DEVE começar na primeira linha — sem comentário antes)
    const ocBody = normalizeForHarness(raw, 'opencode', true)
    const ocContent =
      openCodeOrchestratorFrontmatter(description, workers) +
      ocBody.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') +
      `\n<!-- gerado por sync-ia.js a partir de .ia/orchestrators/${file} — não edite -->\n`

    write(join('.claude', 'agents', file), claudeContent)
    write(join('.opencode', 'agents', file), ocContent)
  }
  banner(
    '.ia/orchestrators',
    '.claude/agents + .opencode/agents',
    files.length * 2
  )
}

/* ------------------------------------------------------------------ */
/* 3. Skills (espelho integral)                                        */
/* ------------------------------------------------------------------ */

const syncSkills = () => {
  const srcDir = join(ROOT, '.ia', 'skills')
  if (!existsSync(srcDir)) {
    warn('.ia/skills/ não existe — nada para espelhar')
    return
  }
  const skills = readdirSync(srcDir).filter((f) =>
    statSync(join(srcDir, f)).isDirectory()
  )
  const targets = ['.agents/skills', '.claude/skills', '.opencode/skills']
  for (const skill of skills) {
    for (const t of targets) {
      const dest = join(ROOT, t, skill)
      if (!DRY) {
        if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
        mkdirSync(dest, { recursive: true })
        cpSync(join(srcDir, skill), dest, { recursive: true })
      } else {
        console.log(`\x1b[90m~ (dry-run)\x1b[0m ${t}/${skill}/ (espelhado)`)
      }
    }
  }
  banner('.ia/skills', targets.join(', '), skills.length)
}

/* ------------------------------------------------------------------ */
/* 4. AGENTS.md → CLAUDE.md                                            */
/* ------------------------------------------------------------------ */

const syncInstructions = () => {
  const agentsMd = read('AGENTS.md')
  write(
    'CLAUDE.md',
    `<!-- gerado por sync-ia.js a partir de AGENTS.md — não edite (edite AGENTS.md) -->\n` +
      agentsMd.trimEnd() +
      '\n'
  )
  banner('AGENTS.md', 'CLAUDE.md', 1)
}

/* ------------------------------------------------------------------ */
/* 5. Limpeza de resíduos em .claude/rules (migrado para .ia/rules)    */
/* ------------------------------------------------------------------ */

const warnStale = () => {
  const stale = [
    ['.claude/rules', 'regras migradas para .ia/rules/'],
    ['.claude/specs', 'specs migradas para .ia/specs/'],
  ]
  for (const [p, hint] of stale) {
    const abs = join(ROOT, p)
    if (existsSync(abs) && readdirSync(abs).length > 0) {
      warn(
        `${p}/ ainda tem arquivos — ${hint}. Revise e remova manualmente se não for mais usado.`
      )
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

const start = Date.now()
log(
  DRY
    ? '\n🔍 sync-ia (dry-run) — nenhuma alteração será feita\n'
    : '\n🔄 sync-ia — sincronizando .ia/ para os harnesses\n'
)
syncWorkers()
syncOrchestrators()
syncSkills()
syncInstructions()
warnStale()
log(
  `\n${DRY ? 'Dry-run' : 'Sync'} concluído em ${((Date.now() - start) / 1000).toFixed(1)}s`
)
if (DRY) log('Rode sem --dry-run para aplicar as mudanças.')
