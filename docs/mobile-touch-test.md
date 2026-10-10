# Teste de toque real em celular (pendência da Fase 8 — fechar assim)

O arrasto da grade (dia/semana) usa Pointer Events — o MESMO caminho para
mouse e dedo (`pointerdown/move/up`, `touch-action: none` só no bloco
arrastável; o fundo da grade continua rolando a página). Isso está coberto por
testes de unidade (happy-dom), mas **toque em hardware real nunca foi
verificado** (sem device no dev). Este doc é o roteiro para fechar a
pendência com o celular no mesmo Wi-Fi do PC.

## 1. Subir o ambiente

```bash
pnpm infra:up      # Postgres + Redis (se ainda não estiverem)
pnpm dev:api       # API em :3001 (aceita LAN — Nest escuta em 0.0.0.0)
pnpm dev:web       # web em :5174 com host:true (vite mostra o URL de rede)
```

O vite vai imprimir algo como `Network: http://192.168.1.21:5174/` — esse é o
URL do celular. (A API NÃO precisa de URL próprio no celular: a web fala com a
API pelo proxy `/api` do vite, que roda no PC. Por isso o alvo do proxy é
`http://127.0.0.1:3001`.)

## 2. Se o celular não conectar (firewall do Windows)

Na primeira tentativa a LAN pode ser bloqueada. Liberar SÓ a porta 5174, só
para a rede privada (remover depois do teste):

```powershell
New-NetFirewallRule -DisplayName "agendabo-dev-web-lan" -Direction Inbound -Protocol TCP -LocalPort 5174 -Action Allow -Profile Private
# depois do teste:
Remove-NetFirewallRule -DisplayName "agendabo-dev-web-lan"
```

Celular e PC precisam estar na MESMA rede Wi-Fi (rede de visitante com
"isolamento de clientes" não funciona).

## 3. Roteiro no celular (logar e testar)

Use uma conta de teste com compromissos de hoje (crie pela web do PC se
preciso). Abra `http://<IP-do-PC>:5174` no Chrome/Safari do celular:

| #   | Ação no toque                                                          | Esperado                                                                                           |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Login + abrir a agenda (visão DIA)                                     | renderiza sem erro; sessão ok (sem 401)                                                            |
| 2   | **Arrastar um compromisso** para outro horário (dedo em cima do bloco) | o bloco segue o dedo; ao soltar, move para o slot; se houver conflito, a proposta do fluxo aparece |
| 3   | Arrastar e **soltar fora de um slot válido** (ou devolver no lugar)    | nada muda (rollback visual, sem request)                                                           |
| 4   | **Rolar a página** com o dedo no fundo da grade (não no bloco)         | a página rola normalmente — o drag do bloco não sequestra o scroll                                 |
| 5   | Tocar (sem arrastar) no bloco                                          | abre o detalhe/edição como o clique do mouse                                                       |
| 6   | Trocar para a visão SEMANA e repetir 2 e 4                             | idem                                                                                               |
| 7   | (se houver 2 compromissos sobrepostos) arrastar um em cima do outro    | o diálogo de conflito do chat web/app abre a proposta de resolução                                 |

Cronômetro aproximado do teste inteiro: ~10 min.

## 4. Fechar a pendência

Fechou todos os itens? Escreva em `ia-docs/plans/grades-dia-semana-mes.plan.md`
(seção de pendência, ~linha 260) `FEITO (data, device/browser)` e apague do
backlog do AGENTS/PROMPT se listado. Achou bug de toque (ex.: o arrasto briga
com o scroll, ou o bloco "gruda" no dedo)? Abra como item novo do backlog com
o comportamento observado — não conserte de primeira no calor do teste.

## Notas de implementação (por que deve funcionar)

- `touch-action: none` só no bloco arrastável → o browser entrega os eventos de
  toque para o JS apenas quando o gesto COMEÇA no bloco; começar no fundo rolou
  a página (regra do browser, intencional).
- `setPointerCapture` (Pointer Events) mantém o arrasto mesmo se o dedo sair do
  bloco no caminho.
- Sem `dblclick` no caminho (toque longo não é exigido em lugar nenhum).
