# Design System & Arquitetura — Painel TV SCNB

Referência pra replicar esse padrão em outro painel/dashboard da Germânia. Numa conversa nova, aponte o Claude pra ler este arquivo (e o `README.md`, e o código de `script.js`/`style.css`/`api/rd.js` como exemplo vivo).

---

## Visual

**Fontes** (Google Fonts): `Barlow Condensed` (pesos 400–900) pra títulos/labels/números — sempre uppercase, letter-spacing 1–3px. `Barlow` (300–700) pro pouco texto corrido que existir. Nunca misturar outra fonte.

**Paleta — modo dark** (idêntica ao `style.css` raiz do Dashboard SCNB, pra tudo da família ficar consistente):

```css
--red:#C92B1E; --red-dk:#9E2015; --gold:#C8941A; --gold-lt:#FFA62C;
--bg:#1A1208; --surface:#221A0E; --card:#261E12; --card2:#2E2418;
--border:rgba(255,200,120,0.10); --border2:rgba(255,200,120,0.16);
--txt:#F1E3CE; --txt-mid:#A89870; --txt-faint:#6B5C40;
--s-green:#1E7A42; --s-red:#B82418; --s-yellow:#966A00;
--blue:#5B7FA6;
```

Verde de celebração/sucesso (mais vibrante que `--s-green`, usado em destaques tipo "venda confirmada"): `#34D399`.

**Header**: gradiente `linear-gradient(180deg,#7A1208 0%,#A82218 45%,var(--red) 100%)` com um radial sutil dourado (`radial-gradient(ellipse at 88% 50%, rgba(255,166,44,0.16) 0%, transparent 55%)`) por cima. Logo = brasão dourado circular da Germânia (`logo.png`), dimensionado pra bater com a altura do bloco eyebrow+h1 ao lado (~59px) — como os dois ficam centralizados na mesma linha flex, alturas iguais alinham topo/base sozinhas, sem posicionamento manual.

**Cards**: `background:var(--card)`, `border:1px solid var(--border)`, `border-radius:14px`, sombra suave (`0 2px 10px rgba(0,0,0,0.25)`).

**Dimensionamento fluido, não pixel fixo**: linhas/barras dentro de um card usam `flex:1` (não altura fixa em px) pra preencher o espaço disponível sem sobrar margem nem vazar/cortar. Aprendido na marra — várias rodadas de "sobra espaço" vs "vaza pela borda" até trocar por flex.

---

## Arquitetura (kiosk sem interação)

- **Sem build step** — HTML+CSS+JS puro, um único `script.js`/`style.css` sem framework.
- **Loop de estados via `setInterval`**, cada estado troca a tela ativa (classe `.active`) e/ou o período de filtro, sem nunca dar `location.reload()` — recarregar a página derruba o modo tela cheia (a Fullscreen API exige um novo gesto do usuário pra reativar, e numa TV desassistida ninguém tá lá pra clicar de novo).
- **Tela cheia**: overlay grande "toque pra tela cheia" no primeiro carregamento + botão no rodapé + tecla de atalho, chamando `element.requestFullscreen()`. Nunca assuma que vai funcionar sozinho — depende de gesto do usuário e do navegador. TV boxes baratos às vezes rodam Firefox forks estranhos sem "Adicionar à tela inicial" (então nem sempre dá pra confiar em PWA/manifest.json como alternativa — inclua de qualquer forma, é inofensivo, mas não confie só nisso).
- **Dados nunca via `fetch` direto de API que exige token no navegador** — se a fonte de dados pede autenticação (token, chave), crie uma função serverless (`api/*.js` na raiz do projeto Vercel, sem precisar de outro backend) que lê o segredo de uma variável de ambiente (`vercel env add NOME_DA_VAR production`) e faz a chamada por trás. O front chama `/api/nome` (mesma origem, sem CORS). **O token nunca pode estar em `script.js` nem em nenhum arquivo commitado** — ver `api/rd.js` como exemplo de proxy pro RD Station CRM.
- **Fontes sem API disponível** (ex: planilha de atendimento) continuam vindo de Google Sheets publicado como CSV (Arquivo → Compartilhar → Publicar na Web → CSV) — parse client-side, sem problema, não é dado sensível.

---

## Gotchas específicos já resolvidos aqui (verifique se seu novo painel tem os mesmos)

- **RD CRM tem múltiplos pipelines/funis na mesma conta** — sempre filtre por `deal_pipeline_id` explícito, senão a API devolve negociação de todos os funis misturados.
- **API do RD pagina em blocos de 200 via cursor** (`next_page`), não dá pra paralelizar (cursor da página N depende da resposta da N-1). Filtre por `created_at_period=custom&start_date&end_date` pra não ter que paginar o histórico inteiro.
- **`win: true/false/null`** já vem pronto na API do RD — não precisa (e não deve) inferir "Ganho/Perdido" por texto de coluna.
- **`deal_products[].amount`** é a quantidade REAL de unidades — não estime por preço se a API já entrega isso.
- **Funil de conversão com janela de tempo mal escolhida vira zero nas etapas finais** — se o ciclo de venda é mais longo que o período que você filtra (semana/mês), quase nada "recém-criado" ainda chegou nas etapas finais. Teste com dado real antes de fixar o tamanho da janela.
- **Perdido não deve contar em funil de pipeline vivo** — só Em Andamento + Ganho, senão os números incluem gente que já disse não.
- **Deduplicação por campo de planilha pode estar corrompida** (ex: coluna formatada como Número no Sheets vira notação científica e junta várias linhas diferentes no mesmo valor) — sempre valide contagens contra outra fonte antes de confiar (ex: "Encerrados > Total de Leads no mesmo mês" é sinal claro de bug).

---

## Como pedir pro Claude replicar isso numa conversa nova

Aponte a pasta desse projeto (`c:\Users\gabriel.costa\Desktop\Painel TV SCNB\`) e peça pra ler este arquivo + `README.md` + o `style.css`/`script.js` como referência viva, antes de começar a construir o novo painel. Se o novo painel também vai puxar de uma API com token, aponte o `api/rd.js` como exemplo do padrão de proxy serverless a seguir.
