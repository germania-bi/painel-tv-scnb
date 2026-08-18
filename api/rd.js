// Proxy server-side pra API do RD Station CRM — o token fica só aqui (variável de
// ambiente RD_TOKEN no Vercel), nunca no código que roda no navegador da TV.
// Filtra direto pelo funil "*Vendas SCNB" e por um período recente (não precisa do
// histórico inteiro pra nada que o painel mostra hoje), paginando até o fim.

const PIPELINE_ID = '693b0733260cfa001311b48a'; // *Vendas SCNB
const JANELA_DIAS = 150; // folga confortável acima da maior janela usada no painel (90d)
const BASE_URL = 'https://crm.rdstation.com/api/v1/deals';

function ymd(d) { return d.toISOString().slice(0, 10); }

function customField(deal, label) {
  const f = (deal.deal_custom_fields || []).find(cf => cf.custom_field && cf.custom_field.label === label);
  if (!f) return '';
  const v = f.value;
  if (Array.isArray(v)) return v.join(';');
  return v == null ? '' : String(v);
}

function transform(d) {
  const produtos = d.deal_products || [];
  const unidades = produtos.length ? produtos.reduce((s, p) => s + (Number(p.amount) || 1), 0) : 1;
  const modelo = customField(d, 'Modelo de Chopeira') || (produtos[0] && produtos[0].name) || '';
  return {
    id: d.id,
    nome: d.name || '',
    etapa: (d.deal_stage && d.deal_stage.name) || '',
    win: d.win === true ? true : d.win === false ? false : null,
    createdAt: d.created_at || null,
    updatedAt: d.updated_at || null,
    closedAt: d.closed_at || null,
    lastActivityAt: d.last_activity_at || null,
    valorUnico: Number(d.amount_unique) || 0,
    unidades,
    modelo,
    vendedorResponsavel: customField(d, 'Vendedor Responsável'),
    unidadesAtendimento: customField(d, 'Unidades de atendimento'),
    campanha: (d.campaign && d.campaign.name) || '',
  };
}

module.exports = async (req, res) => {
  const token = process.env.RD_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'RD_TOKEN não configurado nas variáveis de ambiente do Vercel' });
    return;
  }
  const now = new Date();
  const start = new Date(now.getTime() - JANELA_DIAS * 864e5);

  const deals = [];
  let nextPage = null;
  let guard = 0;
  try {
    do {
      const params = new URLSearchParams({
        token,
        deal_pipeline_id: PIPELINE_ID,
        created_at_period: 'custom',
        start_date: ymd(start),
        end_date: ymd(now),
        limit: '200',
      });
      if (nextPage) params.set('next_page', nextPage);
      const r = await fetch(BASE_URL + '?' + params.toString());
      if (!r.ok) throw new Error('RD API HTTP ' + r.status);
      const data = await r.json();
      (data.deals || []).forEach(d => deals.push(transform(d)));
      nextPage = data.has_more ? data.next_page : null;
      guard++;
    } while (nextPage && guard < 15);

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600');
    res.status(200).json({ deals, count: deals.length, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
