// ═══════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════
// RD CRM vem direto da API (via proxy serverless em /api/rd, token fica só no
// servidor). EZ (atendimento) continua vindo do Google Sheets publicado — mesma
// fonte do Dashboard SCNB, sem API disponível por enquanto.
const URLS = {
  rd:    '/api/rd',
  ez:    'https://docs.google.com/spreadsheets/d/e/2PACX-1vSmgtuSBRI86Jz3JvRLbPquLflDNM9wHVjlrq-xDtgq7F6pY8jVXZBSyA4PDGbGgg_S77jOH0yw80ue/pub?gid=515237738&single=true&output=csv',
};
const REFRESH_MS = 10*60*1000;      // recarrega os dados a cada 10 min
const STATE_MS = 15*1000;           // cada tela+periodo fica 15s no ar
const META_VENDAS_MES = 20;         // meta fixa: 20 vendas (Germânia + Loja) por mês
const META_VENDAS_SEMANA = Math.round(META_VENDAS_MES/4); // proporcional, arredondado

// ═══════════════════════════════════════════════════════
// PARSE HELPERS — copiados 1:1 do Dashboard SCNB pra bater com os mesmos numeros
// ═══════════════════════════════════════════════════════
function splitCSV(l,delim=','){
  const r=[];let cur='',inQ=false;
  for(let i=0;i<l.length;i++){
    const c=l[i];
    if(c==='"'){inQ=!inQ;}
    else if(c===delim&&!inQ){r.push(cur);cur='';}
    else{cur+=c;}
  }
  r.push(cur);return r;
}
function parseCSV(txt){
  const lines=txt.replace(/\r/g,'').split('\n').filter(l=>l.trim());
  if(!lines.length) return [];
  let start=0;
  if(lines[0].toLowerCase().startsWith('sep=')) start=1;
  const firstLine=lines[start].replace(/^﻿/,'');
  const delim=firstLine.indexOf(';')>firstLine.indexOf(',')&&firstLine.indexOf(';')>-1?';':',';
  const hdr=firstLine.split(delim).map(h=>h.trim().replace(/^"|"$/g,''));
  return lines.slice(start+1).map(line=>{
    const vals=splitCSV(line,delim),obj={};
    hdr.forEach((h,i)=>obj[h]=(vals[i]||'').trim().replace(/^"|"$/g,''));
    return obj;
  });
}
function parseDate(s){
  if(!s||s==='-'||!s.trim()||s==='0') return null;
  s=s.trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)){
    const pts=s.split(/[-T ]/);
    const d=new Date(+pts[0],+pts[1]-1,+pts[2]);
    return isNaN(d)?null:d;
  }
  const p=s.split(' '),dp=p[0].split('/');
  if(dp.length<3) return null;
  let a=Number(dp[0]),b=Number(dp[1]),c=Number(dp[2]);
  if(isNaN(a)||isNaN(b)||isNaN(c)) return null;
  const twoDigit=(dp[2].length<=2);
  if(c<100) c+=2000;
  let dd,mm;
  if(a>12)          {dd=a;mm=b;}
  else if(b>12)     {mm=a;dd=b;}
  else if(twoDigit) {mm=a;dd=b;}
  else              {dd=a;mm=b;}
  if(mm<1||mm>12||dd<1||dd>31) return null;
  if(p[1]){const tp=p[1].split(':');return new Date(c,mm-1,dd,Number(tp[0])||0,Number(tp[1])||0);}
  return new Date(c,mm-1,dd);
}
function parseDT(s){
  if(!s||s==='-') return null;
  const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if(!m) return null;
  return new Date(+m[3],+m[2]-1,+m[1],+m[4],+m[5],+(m[6]||0));
}
function parseBRL(s,centavos=false){
  if(!s) return 0;
  s=String(s).replace(/[R$\s%]/g,'').trim();
  if(!s) return 0;
  if(s.includes('.')&&s.includes(',')) s=s.replace(/\./g,'').replace(',','.');
  else if(s.includes(',')&&!s.includes('.')) s=s.replace(',','.');
  const v=parseFloat(s);
  if(isNaN(v)) return 0;
  return centavos?v/100:v;
}
function parseMin(s){
  if(!s||s==='-'||s==='0') return null;
  const p=s.split(':');
  if(p.length===3) return +p[0]*60+ +p[1]+ +p[2]/60;
  if(p.length===2) return +p[0]*60+ +p[1];
  return null;
}
function fmtMin(m){
  if(m===null||m===undefined||isNaN(m)) return '--';
  const h=Math.floor(m/60),mn=Math.floor(m%60);
  if(h>0) return h+'h '+mn+'m';
  return mn+'m';
}
function fmtBRL(v){return v&&!isNaN(v)?'R$'+parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0}):'--';}
function fmtBRLk(v){
  if(!v||isNaN(v)) return '--';
  if(v>=1000000) return 'R$'+Math.round(v/100000)/10+'M';
  if(v>=1000) return 'R$'+Math.round(v/1000)+'k';
  return fmtBRL(v);
}

// Deals vêm da API do RD CRM (via /api/rd) já num formato limpo — ver api/rd.js.
// win: true=Ganho, false=Perdido, null=Em Andamento.
function estadoNorm(r){ return r.win===true?'Ganho':r.win===false?'Perdido':'Em Andamento'; }
function isLoja(r){ return !!(r.vendedorResponsavel&&r.vendedorResponsavel.trim()); }
function dCriacao(r){ return r.createdAt?new Date(r.createdAt):null; }
function dFechamento(r){ return r.closedAt?new Date(r.closedAt):null; }
function valorUnico(r){ return r.valorUnico||0; }
// Unidades agora vem direto do RD (soma de deal_products[].amount) — antes era uma
// estimativa por preço tabelado (Valor Único ÷ preço do modelo); a API já traz a
// quantidade real, então essa conta não é mais necessária.
function unidades(r){ return r.unidades||1; }
function sumUnidades(arr){return arr.reduce((s,r)=>s+unidades(r),0);}
function calcTPI(r){
  const pia=r['Primeira Interação do Agente'];
  const cri=r['Criado em'];
  if(pia&&pia!=='-'&&cri){const t1=parseDT(cri),t2=parseDT(pia);if(t1&&t2&&t2>=t1)return(t2-t1)/60000;}
  return parseMin(r['Tempo para Primeira Interação']||r['TPI']);
}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}
// Tickets travados/reabertos podem levar dias pra primeira interação e destroem a média —
// exclui TPI acima de 24h (1440min) do cálculo, como referência de mercado pro indicador.
function avgTPI(vals){
  const validos=vals.filter(v=>v<=1440);
  const base=validos.length?validos:vals;
  return avg(base);
}

function isScnbEZ(r){ return (r['Nome do Agente']||'').toLowerCase().includes('mirian'); }
// A coluna "Protocolo" da planilha EZ virou notação científica em algum momento (ex: "2,61E+11"),
// fazendo centenas de protocolos DIFERENTES virarem essa mesma string truncada. A primeira versão
// deste fallback tratava cada linha corrompida como única — só que o export tem MÚLTIPLAS linhas
// por conversa (snapshot a cada atualização: um contato chegou a ter 22 linhas no mesmo dia), então
// isso inflava MUITO as contagens (ex: Encerrados > Total de Leads no mesmo período). Fallback
// melhor: Contato/Telefone + dia — agrupa snapshots da mesma conversa no mesmo dia, mas ainda
// separa contatos diferentes e o mesmo contato voltando em outro dia. Enquanto a coluna Protocolo
// não for reformatada como texto na origem, essa é a aproximação disponível.
function protocoloCorrompido(p){ return /^[\d.,]+E[+-]?\d+$/i.test((p||'').trim()); }
function dedupEZ(arr){
  const map={};
  arr.forEach(r=>{
    const tipo=(r['Tipo']||'').toLowerCase().trim();
    if(tipo==='bot'||tipo==='automatizado'||tipo==='robot') return;
    let proto=(r['Protocolo']||'').toString().trim();
    if(!proto) return;
    const dt=parseDate(r['Criado em']);
    if(protocoloCorrompido(proto)){
      const contato=(r['Contato']||r['Telefone']||'').trim().toLowerCase();
      proto='__c_'+contato+'|'+(dt?dt.toDateString():'');
    }
    const ia=parseInt(r['Contagem de Interações do Agente']||'0')||0;
    if(!map[proto]){map[proto]={...r,_ia:ia,_dt:dt};}
    else{
      const prev=map[proto];
      if(ia>prev._ia||(ia===prev._ia&&dt&&prev._dt&&dt<prev._dt)) map[proto]={...r,_ia:ia,_dt:dt};
    }
  });
  return Object.values(map);
}
function ezInRange(from,to){
  return dedupEZ(rawEZ.filter(r=>isScnbEZ(r))).filter(r=>{
    const d=parseDate(r['Criado em']);
    return d&&d>=from&&d<=to;
  });
}

// ═══════════════════════════════════════════════════════
// FUNIL — 8 etapas reais do RD CRM, simplificadas em 5 marcos cumulativos
// ("chegou nesta etapa ou foi além" — por isso os numeros so caem, nunca sobem)
// ═══════════════════════════════════════════════════════
const ETAPAS_ORDER=[
  'Entrada SCNB / Qualificação',
  'Atendimento / Demonstração',
  'Assinatura de Contrato',
  'Processamento de Pagamento',
  'Cadastro no Sistema',
  'Preparação da Chopeira',
  'Entrega da Chopeira',
  'Acompanhamento / Relacionamento',
];
function stageIdx(r){
  return ETAPAS_ORDER.indexOf((r.etapa||'').trim());
}
const FUNIL_MARCOS=[
  {label:'Lead',              min:-1},
  {label:'Qualificado',       min:1},
  {label:'Emissão Contrato',  min:2},
  {label:'Aguar. Pagamento',  min:3},
  {label:'Venda',             min:Infinity}, // só Ganho
];
// Etapas tardias — usadas na lista "Pode virar venda"
const ETAPAS_TARDIAS=new Set(['Assinatura de Contrato','Processamento de Pagamento']);
// O RD CRM não tem um campo de "data de entrada na etapa atual" — a aproximação
// disponível é last_activity_at (nativo da API, cai pra createdAt se nunca teve
// atividade registrada). Não é exatamente "tempo na etapa", é "tempo desde a
// última atividade registrada nessa negociação".
function ultimaAtividade(r){
  if(r.lastActivityAt) return new Date(r.lastActivityAt);
  return dCriacao(r);
}

// ═══════════════════════════════════════════════════════
// PERIODO — semana (seg-dom) e mes corrente, sem picker (kiosk nao interage)
// ═══════════════════════════════════════════════════════
const MESES=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
// Semana = quarto do mês (S1-S4), mesma convenção já usada no Dashboard SCNB (dia<=9→S1,
// <=16→S2, <=23→S3, resto→S4) — não é semana ISO. "Semana anterior" pode cruzar pro mês
// passado (S1 de agosto → S4 de julho), computado recalculando a partir de 1 dia antes.
function weekRange(ref){
  const y=ref.getFullYear(),m=ref.getMonth(),d=ref.getDate();
  const ultimoDia=new Date(y,m+1,0).getDate();
  let sNum,from,to;
  if(d<=9){ sNum=1; from=new Date(y,m,1); to=new Date(y,m,9,23,59,59,999); }
  else if(d<=16){ sNum=2; from=new Date(y,m,10); to=new Date(y,m,16,23,59,59,999); }
  else if(d<=23){ sNum=3; from=new Date(y,m,17); to=new Date(y,m,23,23,59,59,999); }
  else{ sNum=4; from=new Date(y,m,24); to=new Date(y,m,ultimoDia,23,59,59,999); }
  return {from,to,sNum};
}
function monthRange(ref){
  const from=new Date(ref.getFullYear(),ref.getMonth(),1);
  const to=new Date(ref.getFullYear(),ref.getMonth()+1,0,23,59,59,999);
  return {from,to};
}
function getPeriod(type){
  const now=new Date();
  if(type==='semana'){
    const cur=weekRange(now);
    const prev=weekRange(new Date(cur.from.getTime()-1*864e5));
    const d1=String(cur.from.getDate()).padStart(2,'0'),d2=String(cur.to.getDate()).padStart(2,'0');
    const label='SEMANA '+cur.sNum+' ('+d1+'–'+d2+' '+MESES[cur.from.getMonth()].slice(0,3).toUpperCase()+')';
    return {cur,prev,label,dlabel:'vs semana anterior'};
  }
  const cur=monthRange(now);
  const prevRef=new Date(now.getFullYear(),now.getMonth()-1,1);
  const prev=monthRange(prevRef);
  return {cur,prev,label:MESES[now.getMonth()].toUpperCase(),dlabel:'vs mês anterior'};
}
function fmtYMD(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let rawRD=[], rawEZ=[];
let lastSyncOk=false;

async function fetchRD(){
  const res=await fetch(URLS.rd,{cache:'no-store'});
  if(!res.ok) throw new Error('HTTP '+res.status);
  const data=await res.json();
  return data.deals||[];
}
async function fetchEZ(){
  const res=await fetch(URLS.ez,{cache:'no-store'});
  if(!res.ok) throw new Error('HTTP '+res.status);
  return parseCSV(await res.text());
}
async function fetchAll(){
  try{
    const [rd,ez]=await Promise.all([fetchRD(),fetchEZ()]);
    rawRD=rd;
    rawEZ=ez;
    lastSyncOk=true;
  }catch(e){
    console.warn('fetchAll:',e);
    lastSyncOk=false;
  }
  setStatus();
}
function setStatus(){
  const dot=document.getElementById('status-dot');
  const txt=document.getElementById('status-txt');
  if(!dot||!txt) return;
  dot.className='dot'+(lastSyncOk?'':' err');
  const now=new Date();
  const hh=String(now.getHours()).padStart(2,'0'),mm=String(now.getMinutes()).padStart(2,'0');
  txt.textContent=(lastSyncOk?'sincronizado ':'falha na sincronização · último ok ')+hh+':'+mm;
}

// ═══════════════════════════════════════════════════════
// COMPUTE — Resumo (Tela 1)
// ═══════════════════════════════════════════════════════
function computeResumo(period){
  const {cur,prev}=period;
  const leadsCur=rawRD.filter(r=>{const d=dCriacao(r);return d&&d>=cur.from&&d<=cur.to;});
  const leadsPrev=rawRD.filter(r=>{const d=dCriacao(r);return d&&d>=prev.from&&d<=prev.to;});
  const ganhoInRange=(range)=>rawRD.filter(r=>{
    if(estadoNorm(r)!=='Ganho') return false;
    const d=dFechamento(r)||dCriacao(r);
    return d&&d>=range.from&&d<=range.to;
  });
  const gCur=ganhoInRange(cur), gPrev=ganhoInRange(prev);
  const vGermCur=sumUnidades(gCur.filter(r=>!isLoja(r))), vGermPrev=sumUnidades(gPrev.filter(r=>!isLoja(r)));
  const vLojaCur=sumUnidades(gCur.filter(r=>isLoja(r))), vLojaPrev=sumUnidades(gPrev.filter(r=>isLoja(r)));
  const fatCur=gCur.reduce((s,r)=>s+valorUnico(r),0);
  const fatPrev=gPrev.reduce((s,r)=>s+valorUnico(r),0);
  const fatGermCur=gCur.filter(r=>!isLoja(r)).reduce((s,r)=>s+valorUnico(r),0);
  const ticket=vGermCur?fatGermCur/vGermCur:0;

  const ezCur=ezInRange(cur.from,cur.to), ezPrev=ezInRange(prev.from,prev.to);
  const tpiCur=avgTPI(ezCur.map(calcTPI).filter(v=>v!=null));
  const tpiPrev=avgTPI(ezPrev.map(calcTPI).filter(v=>v!=null));
  const atendCur=ezCur.filter(r=>r['Status']==='Em atendimento').length;
  const encerCur=ezCur.filter(r=>r['Status']==='Finalizado').length;
  const pctFinal=ezCur.length?Math.round(encerCur/ezCur.length*100):0;

  // Meta = 20 vendas/mês (Germânia + Loja), fixa — proporcional pra semana
  const vendasTotalCur=vGermCur+vLojaCur;
  const metaAlvo=period.type==='mes'?META_VENDAS_MES:META_VENDAS_SEMANA;
  const meta={alvo:metaAlvo,atual:vendasTotalCur,pct:Math.round(vendasTotalCur/metaAlvo*100)};

  return{
    leads:leadsCur.length, leadsPrev:leadsPrev.length,
    vGerm:vGermCur, vGermPrev, vLoja:vLojaCur, vLojaPrev,
    fat:fatCur, fatPrev, ticket,
    tpi:tpiCur, tpiPrev, atend:atendCur, encerrados:encerCur, pctFinal, totalAtend:ezCur.length,
    meta,
  };
}

// ═══════════════════════════════════════════════════════
// COMPUTE — Funil (Tela 2)
// ═══════════════════════════════════════════════════════
// Ciclo de venda de chopeira dura semanas — um funil restrito estritamente ao período
// (semana/mês) zeraria nas etapas finais quase sempre (nenhum lead recém-criado ainda
// chegou lá) e comparar populações diferentes por etapa quebra o formato (etapa 2 > etapa 1).
// Por isso as 5 etapas usam sempre a MESMA janela por estado — só o TAMANHO da janela muda
// entre semana (30 dias, pulso recente) e mês (90 dias, visão mais ampla) — testado com dado
// real: 14 dias já zera nas etapas finais, 30 e 90 dias dão formas diferentes e nunca zeram.
const FUNIL_JANELA={semana:30, mes:90};
function computeFunil(period){
  const {cur,type}=period;
  const janelaDias=FUNIL_JANELA[type]||90;
  const janelaFrom=new Date(cur.to.getTime()-janelaDias*864e5);
  // Perdido não conta em nenhuma etapa do funil (nem "Lead") — é um funil de
  // pipeline vivo, não histórico de tudo que já passou por ali algum dia.
  const pipeline=rawRD.filter(r=>{
    if(isLoja(r)) return false;
    if(estadoNorm(r)==='Perdido') return false;
    const d=dCriacao(r);
    return d&&d>=janelaFrom&&d<=cur.to;
  });
  const steps=FUNIL_MARCOS.map(m=>{
    const n=pipeline.filter(r=>{
      if(m.min===-1) return true;
      return estadoNorm(r)==='Ganho'||stageIdx(r)>=m.min;
    }).length;
    return {label:m.label,n};
  });
  const base=steps[0].n||1;
  // % de conversão em relação à etapa ANTERIOR (mais informativo que % do topo, que
  // vira 1%/1%/1% sempre que a queda entre 2 e 3 é grande — esconde onde o funil trava)
  steps.forEach((s,i)=>{
    s.pctTotal=Math.round(s.n/base*100);
    s.pct=i===0?100:(steps[i-1].n?Math.round(s.n/steps[i-1].n*100):0);
  });

  const agora=Date.now();

  // Pendentes: negociações Em Andamento nas 2 etapas tardias, ordenadas pela mais
  // parada primeiro (maior tempo desde a última atividade registrada)
  const urgenteFrom=new Date(agora-30*864e5);
  let pendentes=rawRD.filter(r=>{
    if(isLoja(r)) return false;
    if(estadoNorm(r)!=='Em Andamento') return false;
    return ETAPAS_TARDIAS.has((r.etapa||'').trim());
  }).map(r=>{
    const d=ultimaAtividade(r);
    const horas=d?(agora-d)/3600000:null;
    return {tipo:'pendente',nome:r.nome||'—',etapa:r.etapa,data:d,horas};
  }).filter(r=>r.data);
  if(type==='semana') pendentes=pendentes.filter(r=>r.data>=urgenteFrom);
  pendentes.sort((a,b)=>a.data-b.data);

  // Vendas: negociações Ganho, aparecem na lista por 48h após o fechamento (celebração)
  const vendas=rawRD.filter(r=>!isLoja(r)&&estadoNorm(r)==='Ganho').map(r=>{
    const d=dFechamento(r);
    const horas=d?(agora-d)/3600000:null;
    return {tipo:'venda',nome:r.nome||'—',etapa:'Venda',data:d,horas};
  }).filter(r=>r.data&&r.horas>=0&&r.horas<=48).sort((a,b)=>a.horas-b.horas);

  const podeVirar=[...vendas,...pendentes].slice(0,8);

  return {steps, podeVirar, janelaDias};
}

// ═══════════════════════════════════════════════════════
// RENDER — helpers
// ═══════════════════════════════════════════════════════
function deltaHTML(cur,prev,{invert=false,dlabel=''}={}){
  if(prev===null||prev===undefined||isNaN(prev)) return '';
  const diff=cur-prev;
  if(Math.abs(diff)<0.001) return `<span class="arrow-flat">＝</span><span class="kpi-delta-label">${dlabel}</span>`;
  const pct=prev!==0?Math.round(Math.abs(diff)/Math.abs(prev)*100):null;
  const up=diff>0;
  const good=invert?!up:up;
  const cls=good?'arrow-up':'arrow-down';
  const arrow=up?'▲':'▼';
  return `<span class="${cls}">${arrow} ${pct!=null?pct+'%':''}</span><span class="kpi-delta-label">${dlabel}</span>`;
}

function renderResumo(period){
  const c=computeResumo(period);
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('r-leads',c.leads);
  set('r-vendas-germ',c.vGerm);
  set('r-vendas-loja',c.vLoja);
  set('r-faturado',fmtBRLk(c.fat));
  set('r-tpi',fmtMin(c.tpi));
  set('r-atend',c.atend);
  set('r-encerrados',c.encerrados);
  set('r-pctfinal',c.pctFinal+'%');

  const d=document.getElementById.bind(document);
  const setDelta=(id,cur,prev,opt)=>{const el=d(id);if(el)el.innerHTML=deltaHTML(cur,prev,opt);};
  setDelta('r-leads-d',c.leads,c.leadsPrev,{dlabel:period.dlabel});
  setDelta('r-vendas-germ-d',c.vGerm,c.vGermPrev,{dlabel:period.dlabel});
  setDelta('r-vendas-loja-d',c.vLoja,c.vLojaPrev,{dlabel:period.dlabel});
  setDelta('r-faturado-d',c.fat,c.fatPrev,{dlabel:period.dlabel});
  setDelta('r-tpi-d',c.tpi,c.tpiPrev,{invert:true,dlabel:period.dlabel});

  const metaSub=document.getElementById('r-meta-sub');
  const metaPct=document.getElementById('r-meta-pct');
  const metaFill=document.getElementById('r-meta-fill');
  if(metaSub) metaSub.textContent=c.meta.atual+' de '+c.meta.alvo+' vendas';
  if(metaPct) metaPct.textContent=c.meta.pct+'%';
  if(metaFill) metaFill.style.width=Math.min(c.meta.pct,100)+'%';
}

// Uma jornada só (cinza neutro → dourado → verde), não 5 cores soltas: Lead é
// neutro (ainda não é "quente"), esquenta em dourado nas etapas de negociação,
// fecha em verde na Venda.
const FUNIL_COLORS=['#8B8580','#A68B54','#C8941A','#6B9955','#34D399'];
function renderFunil(period){
  const {steps,podeVirar,janelaDias}=computeFunil(period);

  const funilSub=document.getElementById('f-funil-sub');
  if(funilSub) funilSub.textContent='pipeline · últimos '+janelaDias+' dias';

  const col=document.getElementById('f-funil-col');
  if(col){
    // Barra sempre "cheia" (mesma largura em todas as etapas) — a contagem e a %
    // de conversão já carregam a magnitude; uma barra proporcional ao topo do funil
    // (288 vs 1) deixava as etapas finais praticamente invisíveis dentro de um
    // container vazio enorme.
    col.innerHTML=steps.map((s,i)=>{
      const pctTxt=i===0?'—':s.pct+'%';
      return `<div class="funil-row">
        <div class="funil-count">${s.n}</div>
        <div class="funil-label" style="color:${FUNIL_COLORS[i]}">${s.label}</div>
        <div class="funil-bar-track"><div class="funil-bar" style="background:${FUNIL_COLORS[i]}"></div></div>
        <div class="funil-pct">${pctTxt}<span class="funil-pct-lbl">${i===0?'':'da etapa ant.'}</span></div>
      </div>`;
    }).join('');
  }

  const pvSub=document.getElementById('f-pv-sub');
  if(pvSub) pvSub.textContent='assinatura de contrato · processamento de pagamento'+(period.type==='semana'?' · últimos 30 dias':'');

  const body=document.getElementById('f-pv-body');
  if(body){
    if(!podeVirar.length){
      body.innerHTML='<div class="pv-empty">Nenhuma negociação em etapa avançada</div>';
    }else{
      body.innerHTML=podeVirar.map(r=>{
        if(r.tipo==='venda'){
          const dd=String(r.data.getDate()).padStart(2,'0'),mm=String(r.data.getMonth()+1).padStart(2,'0');
          return `<div class="pv-card tipo-venda">
            <div class="pv-card-nome">🎉 ${r.nome}</div>
            <div class="pv-card-etapa">Venda confirmada</div>
            <div class="pv-card-meta"><span>fechou ${dd}/${mm}</span><span class="pv-card-dias">há ${Math.round(r.horas)}h</span></div>
          </div>`;
        }
        const urgCls=r.horas>48?'urg-red':r.horas>24?'urg-yellow':'';
        const dd=String(r.data.getDate()).padStart(2,'0'),mm=String(r.data.getMonth()+1).padStart(2,'0');
        return `<div class="pv-card ${urgCls}">
          <div class="pv-card-nome">${r.nome}</div>
          <div class="pv-card-etapa">${r.etapa}</div>
          <div class="pv-card-meta"><span>últ. atividade ${dd}/${mm}</span><span class="pv-card-dias">há ${Math.round(r.horas)}h</span></div>
        </div>`;
      }).join('');
    }
  }
}

// ═══════════════════════════════════════════════════════
// LOOP — 4 estados de 15s = 60s por volta completa
// ═══════════════════════════════════════════════════════
const STATES=[
  {screen:'resumo',type:'semana'},
  {screen:'resumo',type:'mes'},
  {screen:'funil', type:'semana'},
  {screen:'funil', type:'mes'},
];
let stateIdx=0;

function applyState(){
  const s=STATES[stateIdx];
  const period={...getPeriod(s.type),type:s.type};

  document.querySelectorAll('.tv-screen').forEach(el=>el.classList.remove('active'));
  document.getElementById('screen-'+s.screen)?.classList.add('active');

  const pill=document.getElementById('h-period-pill');
  const pillLabel=document.getElementById('h-period-label');
  if(pill&&pillLabel){
    pillLabel.textContent=period.label;
    pill.classList.remove('tipo-semana','tipo-mes');
    pill.classList.add(s.type==='semana'?'tipo-semana':'tipo-mes');
    // reinicia a animação removendo e reforçando reflow, senão reaplicar a
    // mesma classe não reinicia o keyframe
    pill.classList.remove('pulse');
    void pill.offsetWidth;
    pill.classList.add('pulse');
  }

  document.querySelectorAll('#progress-dots span').forEach((el,i)=>el.classList.toggle('active',i===stateIdx));

  // Cronômetro colado na borda inferior do próprio pill (não mais na linha do header)
  const timer=document.getElementById('period-timer');
  if(timer){
    timer.classList.remove('counting');
    void timer.offsetWidth; // reinicia a animação (reaplicar a mesma classe não reinicia o keyframe)
    timer.classList.add('counting');
  }

  if(s.screen==='resumo') renderResumo(period);
  else renderFunil(period);
}
function tick(){
  applyState();
  stateIdx=(stateIdx+1)%STATES.length;
}

// ═══════════════════════════════════════════════════════
// RELÓGIO
// ═══════════════════════════════════════════════════════
function tickClock(){
  const el=document.getElementById('h-clock');
  if(!el) return;
  const n=new Date();
  el.textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
}

// ═══════════════════════════════════════════════════════
// TELA CHEIA — overlay de boas-vindas + botão no rodapé + tecla F
// (Fullscreen API exige gesto do usuário, não dá pra entrar sozinho ao carregar)
// ═══════════════════════════════════════════════════════
function hideFsOverlay(){
  document.getElementById('fs-overlay')?.classList.add('hidden');
}
function toggleFullscreen(){
  if(!document.fullscreenElement){
    document.documentElement.requestFullscreen?.()
      .then(hideFsOverlay)
      .catch(hideFsOverlay); // se a API falhar aqui, não trava o usuário atrás do overlay
  }else{
    document.exitFullscreen?.();
  }
}
function dismissFsOverlay(ev){
  ev.stopPropagation();
  hideFsOverlay();
}
document.addEventListener('keydown',e=>{
  if(e.key==='f'||e.key==='F') toggleFullscreen();
});
document.addEventListener('fullscreenchange',()=>{
  const btn=document.getElementById('fs-btn');
  if(btn) btn.textContent=document.fullscreenElement?'⛶ Sair da Tela Cheia':'⛶ Tela Cheia';
  if(document.fullscreenElement) hideFsOverlay();
});

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
(async function init(){
  await fetchAll();
  tick();
  tickClock();
  setInterval(tick, STATE_MS);
  setInterval(tickClock, 1000);
  setInterval(async ()=>{ await fetchAll(); }, REFRESH_MS);
  // Sem reload periódico de página: recarregar navegaria fora do modo tela cheia e a
  // Fullscreen API exige um clique novo do usuário pra reativar — ninguém vai estar lá
  // pra clicar de novo numa TV. Os dados já se atualizam sozinhos via fetchAll acima.
})();
