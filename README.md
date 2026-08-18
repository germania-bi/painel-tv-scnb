# Painel TV · Sua Casa Nosso Bar

Painel de apresentação (modo TV/kiosk) pra rodar numa tela interna do setor comercial, sem interação — 21,5" 16:9 (1920×1080).

## Como funciona

Roda em loop contínuo de 60s, alternando 4 estados de 15s cada:

1. **Resumo** — filtro semana
2. **Resumo** — filtro mês
3. **Funil** — filtro semana
4. **Funil** — filtro mês

Os dados são recarregados a cada 10 minutos, sem navegar/recarregar a página inteira (recarregar a página derrubaria o modo tela cheia, que exige um novo clique do usuário pra reativar — ruim numa TV desassistida).

## Como abrir na TV

Abra a URL publicada no navegador e clique no botão **"Tela Cheia"** no rodapé (ou tecla **F**) — a Fullscreen API exige um clique/gesto do usuário, não dá pra entrar sozinho ao carregar a página. Alternativa: F11 do navegador, ou iniciar o Chrome direto em modo kiosk:

```
chrome --kiosk --incognito https://<sua-url>.vercel.app
```

## Fontes de dados

- **RD CRM (negociações)** — direto da API do RD Station CRM, via proxy serverless em `api/rd.js`. Filtra pelo funil "\*Vendas SCNB" (`deal_pipeline_id` fixo no arquivo) e por uma janela de 150 dias (folga acima dos 90 dias usados no Funil). O token fica só na variável de ambiente `RD_TOKEN` no Vercel (Project Settings → Environment Variables) — nunca no código, nunca no navegador. Pra trocar o token: `vercel env rm RD_TOKEN production` e `vercel env add RD_TOKEN production`.
- **EZ (atendimento WhatsApp)** — continua vindo do Google Sheets publicado (mesma planilha do Dashboard SCNB), sem API disponível por enquanto. URL em `script.js`, objeto `URLS.ez`.

### Meta de Vendas

Alvo fixo no código (`script.js`, constante `META_VENDAS_MES`): **20 vendas/mês** (Germânia + Loja somadas), com meta semanal proporcional (`META_VENDAS_SEMANA`, hoje 5). Pra mudar o número, edite essas duas constantes direto no script — não depende de planilha.

## Achado importante — planilha EZ

A coluna **Protocolo** da planilha de Atendimento EZ está sendo exportada em notação científica (ex: `2,61E+11`) desde ~21/07/2026, provavelmente porque a coluna foi formatada como "Número" em algum momento no Sheets. Isso faz centenas de protocolos diferentes colapsarem no mesmo valor truncado.

Esse painel já contorna o problema no código (`protocoloCorrompido()` em script.js), mas o **Dashboard SCNB também usa essa mesma coluna pro mesmo tipo de deduplicação e está sujeito ao mesmo problema** — vale reformatar a coluna Protocolo como **Texto simples** na planilha de origem (ou prefixar os valores com `'` no Sheets) pra resolver na raiz.

## Estrutura

Sem build step — HTML + CSS + JS puro, mesmo padrão do Dashboard SCNB / Dashboard Chopp / funil-rd-dashboard.

- `index.html` — estrutura das duas telas
- `style.css` — design system (paleta dark, mesmas variáveis de cor do Dashboard SCNB)
- `script.js` — fetch de dados, cálculos, motor de rotação
- `logo.png` — logo Germânia
