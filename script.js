/* ==========================================================================
   DRIVE ANALYTICS — script.js
   Vanilla JS, no framework. Organized in logical modules via IIFE namespaces.
   Persistence: Supabase (cloud), com cache local em memória pra renderizar
   as telas de forma síncrona sem precisar reescrever toda a UI em async.
   ========================================================================== */

const LS_THEME = 'da_theme_v1';
// Chaves antigas (localStorage), usadas só pela importação única em Configurações.
const OLD_LS_ENTRIES = 'da_entries_v1';
const OLD_LS_CONFIG  = 'da_config_v1';
const OLD_LS_DESPESAS = 'da_despesas_v1';
const OLD_LS_MANUT    = 'da_manutencoes_v1';

const SUPABASE_URL = 'https://efapnmnxlgbjetumilgm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_H8kwooKJ_9g5_icS-87dxA_MZmh1lQp';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ============================== STORE =================================== */
const Store = (() => {
  let _entries = [];
  let _despesas = [];
  let _manutencoes = [];
  let _config = defaultConfig();

  function defaultConfig(){
    return { aluguel:0, terreno:0, alimentacaoFixa:0, energia:0, internet:0, telefone:0, financiamento:0, outrasContas:0 };
  }

  // Mapeamento camelCase (usado no JS) <-> snake_case (colunas do Postgres).
  const ENTRY_MAP = {
    id:'id', data:'data', app:'app', moto:'moto', obs:'obs', inicio:'inicio', fim:'fim',
    tempoCorrida:'tempo_corrida', tempoOffline:'tempo_offline', corridas:'corridas', canceladas:'canceladas',
    fatUber:'fat_uber', fat99:'fat_99', gorjetas:'gorjetas', promocoes:'promocoes', extras:'extras',
    valorComb:'valor_comb', precoLitro:'preco_litro', litros:'litros', hodIni:'hod_ini', hodFim:'hod_fim',
    taxaUber:'taxa_uber', taxa99:'taxa_99', alimentacao:'alimentacao', estacionamento:'estacionamento',
    lavagem:'lavagem', oleoCusto:'oleo_custo', outros:'outros', mOleo:'m_oleo', mRelacao:'m_relacao',
    mPneus:'m_pneus', mPastilhas:'m_pastilhas', mRevisao:'m_revisao'
  };
  const DESPESA_MAP = { id:'id', data:'data', hora:'hora', categoria:'categoria', valor:'valor', descricao:'descricao', loja:'loja', obs:'obs' };
  const MANUT_MAP = { id:'id', data:'data', hora:'hora', tipo:'tipo', valor:'valor', descricao:'descricao', oficina:'oficina', mecanico:'mecanico', hodometro:'hodometro', obs:'obs' };
  const CONFIG_MAP = { aluguel:'aluguel', terreno:'terreno', alimentacaoFixa:'alimentacao_fixa', energia:'energia', internet:'internet', telefone:'telefone', financiamento:'financiamento', outrasContas:'outras_contas' };

  function toDb(obj, map){
    const row = {};
    Object.keys(map).forEach(jsKey => { row[map[jsKey]] = obj[jsKey]; });
    return row;
  }
  function fromDb(row, map){
    const obj = {};
    Object.keys(map).forEach(jsKey => { obj[jsKey] = row[map[jsKey]]; });
    return obj;
  }

  // Busca tudo da nuvem de uma vez só, logo depois do login.
  async function loadAll(){
    const [entriesRes, despesasRes, manutRes, configRes] = await Promise.all([
      sbClient.from('da_entries').select('*').order('data'),
      sbClient.from('da_despesas').select('*').order('data'),
      sbClient.from('da_manutencoes').select('*').order('data'),
      sbClient.from('da_config').select('*').limit(1)
    ]);
    const firstError = entriesRes.error || despesasRes.error || manutRes.error || configRes.error;
    if (firstError) throw firstError;
    _entries = (entriesRes.data||[]).map(r => fromDb(r, ENTRY_MAP));
    _despesas = (despesasRes.data||[]).map(r => fromDb(r, DESPESA_MAP));
    _manutencoes = (manutRes.data||[]).map(r => fromDb(r, MANUT_MAP));
    _config = (configRes.data && configRes.data[0]) ? fromDb(configRes.data[0], CONFIG_MAP) : defaultConfig();
  }

  /* ---- lançamentos diários ---- */
  function getEntries(){ return _entries; }
  async function upsertEntry(entry){
    const row = toDb(entry, ENTRY_MAP);
    const { error } = await sbClient.from('da_entries').upsert(row, { onConflict:'id' });
    if (error) throw error;
    const idx = _entries.findIndex(e => e.id === entry.id);
    if (idx >= 0) _entries[idx] = entry; else _entries.push(entry);
    _entries.sort((a,b) => a.data.localeCompare(b.data));
  }
  async function deleteEntry(id){
    const { error } = await sbClient.from('da_entries').delete().eq('id', id);
    if (error) throw error;
    _entries = _entries.filter(e => e.id !== id);
  }
  async function deleteAllEntries(){
    const { error } = await sbClient.from('da_entries').delete().neq('id', '__none__');
    if (error) throw error;
    _entries = [];
  }

  /* ---- configurações (despesas fixas) ---- */
  function getConfig(){ return _config; }
  async function saveConfig(cfg){
    const row = toDb(cfg, CONFIG_MAP);
    const { error } = await sbClient.from('da_config').upsert(row, { onConflict:'user_id' });
    if (error) throw error;
    _config = cfg;
  }

  // Genérico: mesma forma de ler/gravar/excluir pra Despesas e Manutenção,
  // só muda a tabela, o mapeamento de colunas e o array de cache usado.
  function makeLog(table, map, cacheRef){
    return {
      getAll(){ return cacheRef(); },
      async upsert(item){
        const row = toDb(item, map);
        const { error } = await sbClient.from(table).upsert(row, { onConflict:'id' });
        if (error) throw error;
        const list = cacheRef();
        const idx = list.findIndex(i => i.id === item.id);
        if (idx >= 0) list[idx] = item; else list.push(item);
        list.sort((a,b) => (a.data+(a.hora||'')).localeCompare(b.data+(b.hora||'')));
      },
      async remove(id){
        const { error } = await sbClient.from(table).delete().eq('id', id);
        if (error) throw error;
        const list = cacheRef();
        const idx = list.findIndex(i => i.id === id);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }
  const Despesas = makeLog('da_despesas', DESPESA_MAP, () => _despesas);
  const Manutencoes = makeLog('da_manutencoes', MANUT_MAP, () => _manutencoes);

  return { loadAll, getEntries, upsertEntry, deleteEntry, deleteAllEntries, getConfig, saveConfig, Despesas, Manutencoes, defaultConfig };
})();

/* ============================== CALC ===================================== */
const Calc = (() => {

  function minutesBetween(startStr, endStr){
    const [sh,sm] = startStr.split(':').map(Number);
    const [eh,em] = endStr.split(':').map(Number);
    let start = sh*60+sm, end = eh*60+em;
    if (end < start) end += 24*60; // overnight shift
    return end - start;
  }

  // Parses "H:MM" or "HH:MM" free-typed duration into minutes. Returns 0 for empty/invalid.
  function parseHM(str){
    if (!str) return 0;
    const m = String(str).trim().match(/^(\d{1,2}):([0-5]\d)$/);
    if (!m) return 0;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function metrics(e){
    const kmRodados = Math.max(0, (e.hodFim||0) - (e.hodIni||0));
    const litros = e.litros > 0 ? e.litros : (e.precoLitro > 0 ? (e.valorComb / e.precoLitro) : 0);
    const kmL = litros > 0 ? kmRodados / litros : 0;

    const receitaBruta = (e.fatUber||0)+(e.fat99||0)+(e.gorjetas||0)+(e.promocoes||0)+(e.extras||0);
    // Taxas agora são valores fixos em R$ (planos/assinaturas), não mais percentual sobre o faturamento.
    const taxaUberValor = e.taxaUber || 0;
    const taxa99Valor   = e.taxa99 || 0;
    const custoManutencao = (e.mOleo||0)+(e.mRelacao||0)+(e.mPneus||0)+(e.mPastilhas||0)+(e.mRevisao||0);

    const custosTotais = taxaUberValor + taxa99Valor + (e.alimentacao||0) + (e.estacionamento||0) +
                          (e.lavagem||0) + (e.oleoCusto||0) + (e.outros||0) + custoManutencao + (e.valorComb||0);

    const receitaLiquida = receitaBruta - (taxaUberValor + taxa99Valor);
    const lucroLiquido = receitaBruta - custosTotais;

    const custoPorKm  = kmRodados > 0 ? custosTotais / kmRodados : 0;
    const valorPorKm   = kmRodados > 0 ? receitaBruta / kmRodados : 0;
    const lucroPorKm   = kmRodados > 0 ? lucroLiquido / kmRodados : 0;

    // Jornada dividida em 3 categorias reais:
    // tempoTotalMin = do início ao término (relógio); tempoCorridaMin = com passageiro;
    // tempoOfflineMin = pausas/almoço/descanso (app fechado ou pausado);
    // tempoOnlineIdleMin (aguardando) = o que sobra: conectado, sem passageiro, esperando chamada.
    const tempoTotalMin = minutesBetween(e.inicio, e.fim);
    const tempoCorridaMin = parseHM(e.tempoCorrida);
    const tempoOfflineMin = parseHM(e.tempoOffline);
    const tempoOnlineIdleMin = Math.max(0, tempoTotalMin - tempoCorridaMin - tempoOfflineMin);
    // "Trabalhando" para fins de R$/hora = tudo que não é pausa deliberada (corrida + aguardando).
    const tempoTrabalhandoMin = tempoTotalMin - tempoOfflineMin;
    const horasTrabalhadas = tempoTrabalhandoMin / 60;
    // Ocupação: da hora que você ficou disponível, quanto foi de fato rodando com passageiro.
    const baseOcupacao = tempoCorridaMin + tempoOnlineIdleMin;
    const taxaOcupacao = baseOcupacao > 0 ? (tempoCorridaMin / baseOcupacao) * 100 : 0;

    const valorMedioCorrida = e.corridas > 0 ? receitaBruta / e.corridas : 0;
    const lucroMedioCorrida = e.corridas > 0 ? lucroLiquido / e.corridas : 0;
    const corridasPorHora   = horasTrabalhadas > 0 ? e.corridas / horasTrabalhadas : 0;
    const receitaPorHora    = horasTrabalhadas > 0 ? receitaBruta / horasTrabalhadas : 0;
    const lucroPorHora      = horasTrabalhadas > 0 ? lucroLiquido / horasTrabalhadas : 0;
    const tempoMedioCorridaMin = e.corridas > 0 ? tempoCorridaMin / e.corridas : 0;

    const pctCombustivel = custosTotais > 0 ? (e.valorComb||0) / custosTotais * 100 : 0;
    const pctTaxas        = custosTotais > 0 ? (taxaUberValor+taxa99Valor) / custosTotais * 100 : 0;
    const pctManutencao   = custosTotais > 0 ? custoManutencao / custosTotais * 100 : 0;

    return {
      kmRodados, litros, kmL, receitaBruta, receitaLiquida, lucroLiquido, custosTotais,
      custoPorKm, valorPorKm, lucroPorKm, tempoTotalMin, tempoCorridaMin, tempoOfflineMin,
      tempoOnlineIdleMin, tempoTrabalhandoMin, horasTrabalhadas, taxaOcupacao,
      valorMedioCorrida, lucroMedioCorrida, corridasPorHora, receitaPorHora, lucroPorHora,
      tempoMedioCorridaMin, pctCombustivel, pctTaxas, pctManutencao, custoManutencao,
      taxaUberValor, taxa99Valor
    };
  }

  function fmtMoney(v){
    return (v||0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }
  function fmtNum(v, dec=1){
    return (v||0).toLocaleString('pt-BR', { minimumFractionDigits:dec, maximumFractionDigits:dec });
  }
  function fmtHM(totalMin){
    const t = Math.round(totalMin||0);
    const h = Math.floor(t/60), m = t%60;
    return `${h}h${String(m).padStart(2,'0')}`;
  }

  return { metrics, fmtMoney, fmtNum, fmtHM, minutesBetween, parseHM };
})();

/* ============================== INSIGHTS ================================= */
const Insights = (() => {
  function generate(today, todayMetrics, history){
    const list = [];
    const past = history.filter(e => e.id !== today.id).map(e => ({ e, m: Calc.metrics(e) }));

    if (past.length === 0){
      list.push({ text: 'Primeiro dia registrado — a partir do segundo lançamento você verá comparações reais.', warn:false });
    } else {
      const avg = (key) => past.reduce((s,p) => s + p.m[key], 0) / past.length;

      const avgKmL = avg('kmL');
      if (avgKmL > 0 && todayMetrics.kmL > 0){
        if (todayMetrics.kmL < avgKmL * 0.9)
          list.push({ text: `Consumo acima da média: ${Calc.fmtNum(todayMetrics.kmL)} km/l hoje contra ${Calc.fmtNum(avgKmL)} km/l de média.`, warn:true });
        else if (todayMetrics.kmL > avgKmL * 1.1)
          list.push({ text: `Consumo melhor que o normal hoje: ${Calc.fmtNum(todayMetrics.kmL)} km/l.`, warn:false });
      }

      const avgLucroHora = avg('lucroPorHora');
      if (todayMetrics.lucroPorHora < avgLucroHora * 0.85)
        list.push({ text: `Seu lucro por hora caiu: ${Calc.fmtMoney(todayMetrics.lucroPorHora)}/h hoje contra ${Calc.fmtMoney(avgLucroHora)}/h de média.`, warn:true });
      else if (todayMetrics.lucroPorHora > avgLucroHora * 1.15)
        list.push({ text: `Lucro por hora acima da média: ${Calc.fmtMoney(todayMetrics.lucroPorHora)}/h.`, warn:false });

      const avgKmPorCorrida = avg('kmRodados') / (past.reduce((s,p)=>s+ (p.e.corridas||0),0) / past.length || 1);
      const kmPorCorridaHoje = today.corridas > 0 ? todayMetrics.kmRodados / today.corridas : 0;
      if (kmPorCorridaHoje > avgKmPorCorrida * 1.3 && today.corridas > 0)
        list.push({ text: `Muitos quilômetros para poucas corridas: ${Calc.fmtNum(kmPorCorridaHoje)} km/corrida contra ${Calc.fmtNum(avgKmPorCorrida)} km/corrida de média.`, warn:true });

      const pctCustoMedio = avg('custosTotais') / (avg('receitaBruta') || 1) * 100;
      const pctCustoHoje = todayMetrics.receitaBruta > 0 ? todayMetrics.custosTotais / todayMetrics.receitaBruta * 100 : 0;
      if (pctCustoHoje > pctCustoMedio + 8)
        list.push({ text: `Custo operacional subindo: ${Calc.fmtNum(pctCustoHoje,0)}% da receita hoje contra ${Calc.fmtNum(pctCustoMedio,0)}% de média.`, warn:true });

      if (todayMetrics.valorPorKm > 0){
        const avgValorPorKm = avg('valorPorKm');
        if (todayMetrics.valorPorKm < avgValorPorKm * 0.85)
          list.push({ text: `Faturamento por km abaixo do ideal: ${Calc.fmtMoney(todayMetrics.valorPorKm)}/km contra ${Calc.fmtMoney(avgValorPorKm)}/km de média.`, warn:true });
      }

      const avgOcupacao = avg('taxaOcupacao');
      if (todayMetrics.taxaOcupacao < 45)
        list.push({ text: `Ocupação baixa hoje (${Calc.fmtNum(todayMetrics.taxaOcupacao,0)}%): você passou mais tempo esperando chamada do que rodando com passageiro — parece falta de demanda, não escolha sua.`, warn:true });
      else if (todayMetrics.taxaOcupacao < avgOcupacao * 0.8 && avgOcupacao > 0)
        list.push({ text: `Ocupação caiu frente à média: ${Calc.fmtNum(todayMetrics.taxaOcupacao,0)}% hoje contra ${Calc.fmtNum(avgOcupacao,0)}% de média.`, warn:true });
    }

    list.push({ text: todayMetrics.lucroLiquido > 0 ? 'Hoje compensou trabalhar — resultado líquido positivo.' : 'Hoje não compensou trabalhar — o resultado líquido foi negativo ou nulo.', warn: todayMetrics.lucroLiquido <= 0 });

    if (todayMetrics.tempoOfflineMin >= 90){
      list.push({ text: `Você ficou ${Calc.fmtHM(todayMetrics.tempoOfflineMin)} offline hoje (pausa/almoço/descanso) — isso foi escolha sua, não falta de demanda.`, warn:false });
    }

    const cfg = Store.getConfig();
    const totalFixo = Object.values(cfg).reduce((a,b)=>a+(Number(b)||0),0);
    if (totalFixo > 0){
      const metaDiaria = totalFixo / 30;
      list.push({ text: `Você precisa faturar em média ${Calc.fmtMoney(metaDiaria)} de lucro por dia para cobrir suas despesas fixas mensais (${Calc.fmtMoney(totalFixo)}/mês).`, warn: todayMetrics.lucroLiquido < metaDiaria });
    }

    if (history.length >= 3){
      const last7 = history.slice(-7);
      const avgLucroDia = last7.reduce((s,e)=>s+Calc.metrics(e).lucroLiquido,0) / last7.length;
      list.push({ text: `No ritmo dos últimos ${last7.length} dias, seu lucro estimado para o mês é de ${Calc.fmtMoney(avgLucroDia*30)}.`, warn:false });
    }

    return list;
  }
  return { generate };
})();

/* ============================== CHARTS ==================================== */
const Charts = (() => {
  let chartReceitaLucro, chartCorridas, chartCustos, chartAcumulado;
  let chartConsumo, chartHoras, chartCustosDia, chartReceitaAcumulada;

  function palette(){
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
      grid: dark ? '#252B3B' : '#DEE1EA',
      text: dark ? '#8B93A7' : '#5B6172',
      accent: dark ? '#F2B705' : '#B9860A',
      accent2: dark ? '#17C3B2' : '#0E9C8E',
      danger: dark ? '#F2545B' : '#D1373F'
    };
  }

  function baseOptions(){
    const p = palette();
    return {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:p.text, font:{ family:'Inter', size:11 } } } },
      scales:{
        x:{ ticks:{ color:p.text, font:{ size:10 } }, grid:{ color:p.grid } },
        y:{ ticks:{ color:p.text, font:{ size:10 } }, grid:{ color:p.grid } }
      }
    };
  }

  function render(history){
    const p = palette();
    const last = history.slice(-14);
    const labels = last.map(e => e.data.slice(5).split('-').reverse().join('/'));
    const receitas = last.map(e => Calc.metrics(e).receitaBruta);
    const lucros   = last.map(e => Calc.metrics(e).lucroLiquido);
    const corridas = last.map(e => e.corridas||0);

    const ctx1 = document.getElementById('chartReceitaLucro');
    if (chartReceitaLucro) chartReceitaLucro.destroy();
    chartReceitaLucro = new Chart(ctx1, {
      type:'line',
      data:{ labels, datasets:[
        { label:'Receita', data:receitas, borderColor:p.accent, backgroundColor:'transparent', tension:.3 },
        { label:'Lucro', data:lucros, borderColor:p.accent2, backgroundColor:'transparent', tension:.3 }
      ]},
      options: baseOptions()
    });

    const ctx2 = document.getElementById('chartCorridas');
    if (chartCorridas) chartCorridas.destroy();
    chartCorridas = new Chart(ctx2, {
      type:'bar',
      data:{ labels, datasets:[{ label:'Corridas', data:corridas, backgroundColor:p.accent }] },
      options: baseOptions()
    });

    // custos por categoria acumulado (todo o histórico)
    const acc = { Combustível:0, Taxas:0, Manutenção:0, Outros:0 };
    history.forEach(e => {
      const m = Calc.metrics(e);
      acc['Combustível'] += (e.valorComb||0);
      acc['Taxas'] += m.taxaUberValor + m.taxa99Valor;
      acc['Manutenção'] += m.custoManutencao;
      acc['Outros'] += (e.alimentacao||0)+(e.estacionamento||0)+(e.lavagem||0)+(e.oleoCusto||0)+(e.outros||0);
    });
    const ctx3 = document.getElementById('chartCustos');
    if (chartCustos) chartCustos.destroy();
    chartCustos = new Chart(ctx3, {
      type:'doughnut',
      data:{ labels:Object.keys(acc), datasets:[{ data:Object.values(acc), backgroundColor:[p.accent,p.danger,p.accent2,p.grid] }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:p.text, font:{ size:10 } } } } }
    });

    // lucro acumulado (toda a série)
    let running = 0;
    const accLabels = history.map(e => e.data.slice(5).split('-').reverse().join('/'));
    const accLucro = history.map(e => running += Calc.metrics(e).lucroLiquido);
    const ctx4 = document.getElementById('chartAcumulado');
    if (chartAcumulado) chartAcumulado.destroy();
    chartAcumulado = new Chart(ctx4, {
      type:'line',
      data:{ labels:accLabels, datasets:[{ label:'Lucro acumulado', data:accLucro, borderColor:p.accent2, backgroundColor:'rgba(23,195,178,.12)', fill:true, tension:.25 }] },
      options: baseOptions()
    });

    // consumo (km/l) por dia — últimos 14
    const consumo = last.map(e => Calc.metrics(e).kmL);
    const ctx5 = document.getElementById('chartConsumo');
    if (chartConsumo) chartConsumo.destroy();
    chartConsumo = new Chart(ctx5, {
      type:'line',
      data:{ labels, datasets:[{ label:'km/l', data:consumo, borderColor:p.accent, backgroundColor:'rgba(242,183,5,.12)', fill:true, tension:.3 }] },
      options: baseOptions()
    });

    // horas trabalhadas por dia — últimos 14
    const horas = last.map(e => Calc.metrics(e).horasTrabalhadas);
    const ctx6 = document.getElementById('chartHoras');
    if (chartHoras) chartHoras.destroy();
    chartHoras = new Chart(ctx6, {
      type:'bar',
      data:{ labels, datasets:[{ label:'Horas', data:horas, backgroundColor:p.accent2 }] },
      options: baseOptions()
    });

    // custos totais por dia — últimos 14
    const custosDia = last.map(e => Calc.metrics(e).custosTotais);
    const ctx7 = document.getElementById('chartCustosDia');
    if (chartCustosDia) chartCustosDia.destroy();
    chartCustosDia = new Chart(ctx7, {
      type:'bar',
      data:{ labels, datasets:[{ label:'Custos', data:custosDia, backgroundColor:p.danger }] },
      options: baseOptions()
    });

    // receita acumulada — toda a série
    let runningReceita = 0;
    const accReceita = history.map(e => runningReceita += Calc.metrics(e).receitaBruta);
    const ctx8 = document.getElementById('chartReceitaAcumulada');
    if (chartReceitaAcumulada) chartReceitaAcumulada.destroy();
    chartReceitaAcumulada = new Chart(ctx8, {
      type:'line',
      data:{ labels:accLabels, datasets:[{ label:'Receita acumulada', data:accReceita, borderColor:p.accent, backgroundColor:'rgba(242,183,5,.12)', fill:true, tension:.25 }] },
      options: baseOptions()
    });
  }

  return { render };
})();

/* ============================== UI ======================================= */
const UI = (() => {

  let editingId = null;

  function init(){
    initTheme();
    initNav();
    initForm();
    initHistory();
    initReports();
    initConfig();
    initImportLocal();
    initDespesas();
    initManutencao();
    initZeroClear();
    initEntryActions();
    document.getElementById('todayPill').textContent = new Date().toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'short' });
    document.getElementById('f_data').value = new Date().toISOString().slice(0,10);
    refreshAll();
    document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('is-open'));
  }

  /* ---------- clique-e-o-zero-some ---------- */
  // Em todo input numérico com valor 0, o primeiro clique/foco seleciona o "0"
  // inteiro, então o primeiro dígito digitado já substitui em vez de concatenar (ex: "05").
  function initZeroClear(){
    document.addEventListener('focusin', ev => {
      const el = ev.target;
      if (el.tagName === 'INPUT' && el.type === 'number' && (el.value === '0' || el.value === '0.00')){
        el.select();
      }
    });
  }

  /* ---------- theme ---------- */
  function initTheme(){
    const saved = localStorage.getItem(LS_THEME) || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeLabel(saved);
    document.getElementById('themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(LS_THEME, next);
      updateThemeLabel(next);
      Charts.render(Store.getEntries());
    });
  }
  function updateThemeLabel(t){
    document.getElementById('themeIcon').textContent = t === 'dark' ? '☾' : '☀';
    document.getElementById('themeLabel').textContent = t === 'dark' ? 'Modo escuro' : 'Modo claro';
  }

  /* ---------- nav ---------- */
  function initNav(){
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
        document.getElementById('view-' + btn.dataset.view).classList.add('is-active');
        const titles = { dashboard:'Painel do dia', lancamento:'Novo lançamento', historico:'Histórico', despesas:'Cadastro de despesas', manutencao:'Manutenção da moto', relatorios:'Relatórios', config:'Configurações' };
        document.getElementById('viewTitle').textContent = titles[btn.dataset.view];
        document.getElementById('sidebar').classList.remove('is-open');
        // Recalcula tudo sempre que troca de aba — nunca deixa uma tela "velha" na tela.
        refreshAll();
        if (btn.dataset.view === 'relatorios'){
          const activeTab = document.querySelector('.rtab.is-active');
          renderReports(activeTab ? activeTab.dataset.range : 'daily');
        }
      });
    });
  }

  /* ---------- form ---------- */
  function readForm(){
    const g = id => document.getElementById(id);
    return {
      id: g('entryId').value || 'e_' + Date.now(),
      data: g('f_data').value,
      app: g('f_app').value,
      moto: g('f_moto').value,
      obs: g('f_obs').value,
      inicio: g('f_inicio').value,
      fim: g('f_fim').value,
      tempoCorrida: g('f_tempoCorrida').value,
      tempoOffline: g('f_tempoOffline').value,
      corridas: Number(g('f_corridas').value)||0,
      canceladas: Number(g('f_canceladas').value)||0,
      fatUber: Number(g('f_fatUber').value)||0,
      fat99: Number(g('f_fat99').value)||0,
      gorjetas: Number(g('f_gorjetas').value)||0,
      promocoes: Number(g('f_promocoes').value)||0,
      extras: Number(g('f_extras').value)||0,
      valorComb: Number(g('f_valorComb').value)||0,
      precoLitro: Number(g('f_precoLitro').value)||0,
      litros: Number(g('f_litros').value)||0,
      hodIni: Number(g('f_hodIni').value)||0,
      hodFim: Number(g('f_hodFim').value)||0,
      taxaUber: Number(g('f_taxaUber').value)||0,
      taxa99: Number(g('f_taxa99').value)||0,
      alimentacao: Number(g('f_alimentacao').value)||0,
      estacionamento: Number(g('f_estacionamento').value)||0,
      lavagem: Number(g('f_lavagem').value)||0,
      oleoCusto: Number(g('f_oleoCusto').value)||0,
      outros: Number(g('f_outros').value)||0,
      mOleo: Number(g('f_mOleo').value)||0,
      mRelacao: Number(g('f_mRelacao').value)||0,
      mPneus: Number(g('f_mPneus').value)||0,
      mPastilhas: Number(g('f_mPastilhas').value)||0,
      mRevisao: Number(g('f_mRevisao').value)||0,
    };
  }

  function fillForm(e){
    const g = id => document.getElementById(id);
    g('entryId').value = e.id;
    g('f_data').value = e.data; g('f_app').value = e.app; g('f_moto').value = e.moto||''; g('f_obs').value = e.obs||'';
    g('f_inicio').value = e.inicio; g('f_fim').value = e.fim;
    g('f_tempoCorrida').value = e.tempoCorrida||''; g('f_tempoOffline').value = e.tempoOffline||'';
    g('f_corridas').value = e.corridas; g('f_canceladas').value = e.canceladas;
    g('f_fatUber').value = e.fatUber; g('f_fat99').value = e.fat99; g('f_gorjetas').value = e.gorjetas;
    g('f_promocoes').value = e.promocoes; g('f_extras').value = e.extras;
    g('f_valorComb').value = e.valorComb; g('f_precoLitro').value = e.precoLitro; g('f_litros').value = e.litros;
    g('f_hodIni').value = e.hodIni; g('f_hodFim').value = e.hodFim;
    g('f_taxaUber').value = e.taxaUber; g('f_taxa99').value = e.taxa99;
    g('f_alimentacao').value = e.alimentacao; g('f_estacionamento').value = e.estacionamento;
    g('f_lavagem').value = e.lavagem; g('f_oleoCusto').value = e.oleoCusto; g('f_outros').value = e.outros;
    g('f_mOleo').value = e.mOleo; g('f_mRelacao').value = e.mRelacao; g('f_mPneus').value = e.mPneus;
    g('f_mPastilhas').value = e.mPastilhas; g('f_mRevisao').value = e.mRevisao;
    editingId = e.id;
    document.getElementById('cancelEditBtn').style.display = 'inline-block';
    document.getElementById('submitBtn').textContent = 'Atualizar lançamento';
  }

  function clearForm(){
    document.getElementById('entryForm').reset();
    document.getElementById('entryId').value = '';
    document.getElementById('f_data').value = new Date().toISOString().slice(0,10);
    document.getElementById('f_taxaUber').value = 0;
    document.getElementById('f_taxa99').value = 0;
    editingId = null;
    document.getElementById('cancelEditBtn').style.display = 'none';
    document.getElementById('submitBtn').textContent = 'Salvar lançamento';
  }

  function initForm(){
    document.getElementById('entryForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const entry = readForm();
      if (entry.hodFim <= entry.hodIni){
        setMsg('formMsg', 'Hodômetro final deve ser maior que o inicial.', true);
        return;
      }
      const hmPattern = /^\d{1,2}:[0-5]\d$/;
      if (entry.tempoCorrida && !hmPattern.test(entry.tempoCorrida)){
        setMsg('formMsg', 'Tempo em corrida deve estar no formato h:mm, ex: 5:44.', true);
        return;
      }
      if (entry.tempoOffline && !hmPattern.test(entry.tempoOffline)){
        setMsg('formMsg', 'Tempo offline deve estar no formato h:mm, ex: 1:30.', true);
        return;
      }
      const wasEditing = !!editingId;
      try {
        setMsg('formMsg', 'Salvando...', false);
        await Store.upsertEntry(entry);
        setMsg('formMsg', wasEditing ? 'Lançamento atualizado.' : 'Lançamento salvo. Pode registrar outro dia ou ir para o Painel.', false);
        clearForm();
        refreshAll();
      } catch(err){
        console.error(err);
        setMsg('formMsg', 'Não foi possível salvar na nuvem. Verifique sua internet e tente de novo.', true);
      }
    });
    document.getElementById('cancelEditBtn').addEventListener('click', clearForm);
  }

  function setMsg(id, text, isError){
    const el = document.getElementById(id);
    el.textContent = text;
    el.style.color = isError ? 'var(--danger)' : 'var(--accent-2)';
    setTimeout(() => el.textContent = '', 5000);
  }

  /* ---------- dashboard ---------- */
  function renderDashboard(){
    const history = Store.getEntries();
    const cardsEl = document.getElementById('statsCards');
    const insightList = document.getElementById('insightList');
    const gauge = document.getElementById('gaugeProfitHour');
    const gaugeValue = document.getElementById('gaugeValue');

    if (history.length === 0){
      cardsEl.innerHTML = '<p style="color:var(--text-dim)">Nenhum lançamento ainda. Registre seu primeiro dia em "Lançamento".</p>';
      gauge.style.setProperty('--pct','0deg');
      gaugeValue.textContent = 'R$ 0,00';
      return;
    }

    const today = history[history.length-1];
    const m = Calc.metrics(today);

    const cards = [
      { label:'Receita', value: Calc.fmtMoney(m.receitaBruta), cls:'' },
      { label:'Lucro', value: Calc.fmtMoney(m.lucroLiquido), cls: m.lucroLiquido>=0?'pos':'neg' },
      { label:'KM/L', value: Calc.fmtNum(m.kmL), cls:'' },
      { label:'KM rodados', value: Calc.fmtNum(m.kmRodados,0), cls:'' },
      { label:'Corridas', value: today.corridas, cls:'' },
      { label:'Valor / hora', value: Calc.fmtMoney(m.receitaPorHora), cls:'' },
      { label:'Lucro / hora', value: Calc.fmtMoney(m.lucroPorHora), cls: m.lucroPorHora>=0?'pos':'neg' },
      { label:'Corridas / hora', value: Calc.fmtNum(m.corridasPorHora), cls:'' },
      { label:'Ocupação', value: Calc.fmtNum(m.taxaOcupacao,0)+'%', cls: m.taxaOcupacao>=60?'pos':(m.taxaOcupacao<40?'neg':'') },
      { label:'Tempo em corrida', value: Calc.fmtHM(m.tempoCorridaMin), cls:'' },
      { label:'Aguardando chamada', value: Calc.fmtHM(m.tempoOnlineIdleMin), cls:'' },
      { label:'Tempo offline', value: Calc.fmtHM(m.tempoOfflineMin), cls:'' },
    ];
    cardsEl.innerHTML = cards.map(c => `
      <div class="stat-card"><div class="label">${c.label}</div><div class="value ${c.cls}">${c.value}</div></div>
    `).join('');

    // gauge: cap visual at R$50/h = 360deg for scale
    const pct = Math.max(0, Math.min(1, m.lucroPorHora / 50));
    gauge.style.setProperty('--pct', (pct*360) + 'deg');
    gaugeValue.textContent = Calc.fmtMoney(m.lucroPorHora);

    const insights = Insights.generate(today, m, history);
    insightList.innerHTML = insights.map(i => `<li class="${i.warn?'warn':''}">${i.text}</li>`).join('');

    Charts.render(history);
  }

  /* ---------- history ---------- */
  function initHistory(){
    document.getElementById('histSearch').addEventListener('input', renderHistory);
    document.getElementById('exportCsvBtn').addEventListener('click', exportSpreadsheet);
    document.getElementById('printBtn').addEventListener('click', () => window.print());
    document.getElementById('configEntriesSearch').addEventListener('input', renderConfigEntries);
  }

  function renderHistory(){
    const q = (document.getElementById('histSearch').value || '').toLowerCase();
    const body = document.getElementById('histBody');
    const history = Store.getEntries().slice().reverse().filter(e =>
      !q || e.data.includes(q) || e.app.toLowerCase().includes(q)
    );
    if (history.length === 0){
      body.innerHTML = `<tr><td colspan="8" style="color:var(--text-dim)">Nenhum registro encontrado.</td></tr>`;
      return;
    }
    body.innerHTML = history.map(e => {
      const m = Calc.metrics(e);
      return `<tr>
        <td>${e.data.split('-').reverse().join('/')}</td>
        <td>${e.app}</td>
        <td>${e.corridas}</td>
        <td>${Calc.fmtMoney(m.receitaBruta)}</td>
        <td>${Calc.fmtMoney(m.custosTotais)}</td>
        <td class="${m.lucroLiquido>=0?'pos':'neg'}">${Calc.fmtMoney(m.lucroLiquido)}</td>
        <td class="${m.lucroPorHora>=0?'pos':'neg'}">${Calc.fmtMoney(m.lucroPorHora)}</td>
        <td class="row-actions">
          <button data-act="edit" data-id="${e.id}" title="Editar">✎</button>
          <button data-act="dup" data-id="${e.id}" title="Duplicar">⧉</button>
          <button data-act="del" data-id="${e.id}" title="Excluir">🗑</button>
        </td>
      </tr>`;
    }).join('');
  }

  /* ---------- entries table inside Configurações (same data, edit/duplicate/delete) ---------- */
  function renderConfigEntries(){
    const bodyEl = document.getElementById('configEntriesBody');
    if (!bodyEl) return;
    const q = (document.getElementById('configEntriesSearch').value || '').toLowerCase();
    const history = Store.getEntries().slice().reverse().filter(e =>
      !q || e.data.includes(q) || e.app.toLowerCase().includes(q)
    );
    if (history.length === 0){
      bodyEl.innerHTML = `<tr><td colspan="5" style="color:var(--text-dim)">Nenhum lançamento salvo ainda.</td></tr>`;
      return;
    }
    bodyEl.innerHTML = history.map(e => {
      const m = Calc.metrics(e);
      return `<tr>
        <td>${e.data.split('-').reverse().join('/')}</td>
        <td>${e.app}</td>
        <td>${e.corridas}</td>
        <td class="${m.lucroLiquido>=0?'pos':'neg'}">${Calc.fmtMoney(m.lucroLiquido)}</td>
        <td class="row-actions">
          <button data-act="edit" data-id="${e.id}" title="Editar">✎</button>
          <button data-act="dup" data-id="${e.id}" title="Duplicar">⧉</button>
          <button data-act="del" data-id="${e.id}" title="Excluir">🗑</button>
        </td>
      </tr>`;
    }).join('');
  }

  // Um único listener delegado cobre os botões de editar/duplicar/excluir
  // tanto na tabela de Histórico quanto na de Configurações.
  function initEntryActions(){
    document.addEventListener('click', async ev => {
      const btn = ev.target.closest('button[data-act][data-id]');
      if (!btn) return;
      const id = btn.dataset.id;
      const store = btn.dataset.store || 'entries';
      const act = btn.dataset.act;

      try {
        if (store === 'despesas'){
          const item = Store.Despesas.getAll().find(e => e.id === id);
          if (!item) return;
          if (act === 'edit'){
            fillDespesaForm(item);
            document.querySelector('.nav-item[data-view="despesas"]').click();
          } else if (act === 'del'){
            if (confirm('Excluir esta despesa? Esta ação não pode ser desfeita.')){
              await Store.Despesas.remove(id);
              renderDespesas();
            }
          }
          return;
        }

        if (store === 'manutencao'){
          const item = Store.Manutencoes.getAll().find(e => e.id === id);
          if (!item) return;
          if (act === 'edit'){
            fillManutForm(item);
            document.querySelector('.nav-item[data-view="manutencao"]').click();
          } else if (act === 'del'){
            if (confirm('Excluir esta manutenção? Esta ação não pode ser desfeita.')){
              await Store.Manutencoes.remove(id);
              renderManutencoes();
            }
          }
          return;
        }

        // store === 'entries' (lançamentos diários — Histórico e Configurações)
        const entry = Store.getEntries().find(e => e.id === id);
        if (!entry) return;
        if (act === 'edit'){
          fillForm(entry);
          document.querySelector('.nav-item[data-view="lancamento"]').click();
          setMsg('formMsg', `Editando lançamento de ${entry.data.split('-').reverse().join('/')}.`, false);
        } else if (act === 'dup'){
          const copy = Object.assign({}, entry, { id:'e_'+Date.now(), data:new Date().toISOString().slice(0,10) });
          await Store.upsertEntry(copy);
          refreshAll();
        } else if (act === 'del'){
          if (confirm('Excluir este lançamento? Esta ação não pode ser desfeita.')){
            await Store.deleteEntry(id);
            refreshAll();
          }
        }
      } catch(err){
        console.error(err);
        alert('Não foi possível concluir a ação na nuvem. Verifique sua internet e tente de novo.');
      }
    });
  }

  function exportSpreadsheet(){
    const history = Store.getEntries();
    if (history.length === 0){ alert('Nenhum dado para exportar.'); return; }
    const rows = history.map(e => {
      const m = Calc.metrics(e);
      return {
        Data:e.data, App:e.app, Moto:e.moto, Corridas:e.corridas, Canceladas:e.canceladas,
        ReceitaBruta:m.receitaBruta.toFixed(2), Custos:m.custosTotais.toFixed(2), LucroLiquido:m.lucroLiquido.toFixed(2),
        KmRodados:m.kmRodados.toFixed(1), KmL:m.kmL.toFixed(2), LucroPorHora:m.lucroPorHora.toFixed(2),
        LucroPorKm:m.lucroPorKm.toFixed(2), CorridasPorHora:m.corridasPorHora.toFixed(2),
        Ocupacao_pct:m.taxaOcupacao.toFixed(1), TempoCorrida:Calc.fmtHM(m.tempoCorridaMin),
        TempoAguardando:Calc.fmtHM(m.tempoOnlineIdleMin), TempoOffline:Calc.fmtHM(m.tempoOfflineMin)
      };
    });
    if (window.XLSX){
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Historico');
      XLSX.writeFile(wb, 'drive-analytics-historico.xlsx');
    } else {
      // fallback CSV
      const header = Object.keys(rows[0]).join(';');
      const body = rows.map(r => Object.values(r).join(';')).join('\n');
      const blob = new Blob([header+'\n'+body], { type:'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'drive-analytics-historico.csv'; a.click();
    }
  }

  /* ---------- reports ---------- */
  function initReports(){
    document.querySelectorAll('.rtab').forEach(tab => tab.addEventListener('click', () => {
      document.querySelectorAll('.rtab').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      renderReports(tab.dataset.range);
    }));
  }

  function renderReports(range){
    const history = Store.getEntries();
    const cardsEl = document.getElementById('reportCards');
    const goalBox = document.getElementById('goalBox');
    if (history.length === 0){
      cardsEl.innerHTML = '<p style="color:var(--text-dim)">Sem dados suficientes ainda.</p>';
      goalBox.innerHTML = '';
      return;
    }
    const days = { daily:1, weekly:7, monthly:30, yearly:365 }[range];
    const slice = history.slice(-days);
    const sum = key => slice.reduce((s,e)=> s + Calc.metrics(e)[key], 0);
    const receita = sum('receitaBruta'), lucro = sum('lucroLiquido'), custos = sum('custosTotais');
    const km = sum('kmRodados'); const corridas = slice.reduce((s,e)=>s+(e.corridas||0),0);
    const horas = sum('horasTrabalhadas');

    const cards = [
      { label:`Receita (${range})`, value: Calc.fmtMoney(receita) },
      { label:`Lucro (${range})`, value: Calc.fmtMoney(lucro), cls: lucro>=0?'pos':'neg' },
      { label:'Custos', value: Calc.fmtMoney(custos) },
      { label:'KM rodados', value: Calc.fmtNum(km,0) },
      { label:'Corridas', value: corridas },
      { label:'Horas trabalhadas', value: Calc.fmtNum(horas) },
      { label:'Lucro/hora médio', value: Calc.fmtMoney(horas>0?lucro/horas:0) },
    ];
    cardsEl.innerHTML = cards.map(c => `<div class="stat-card"><div class="label">${c.label}</div><div class="value ${c.cls||''}">${c.value}</div></div>`).join('');

    // projeções e meta
    const avgDia = lucro / slice.length;
    const cfg = Store.getConfig();
    const totalFixo = Object.values(cfg).reduce((a,b)=>a+(Number(b)||0),0);
    const metaDiaria = totalFixo/30, metaSemanal = totalFixo/4.3, metaMensal = totalFixo;
    const diasParaMeta = avgDia > 0 ? Math.ceil(totalFixo/avgDia) : Infinity;

    // Despesas avulsas e manutenção registradas no mesmo período — informativo, NÃO é
    // subtraído do lucro líquido acima (a manutenção do dia a dia já entra no custo diário
    // do Lançamento; isto aqui evita contar a mesma coisa duas vezes).
    const cutoff = slice.length ? slice[0].data : null;
    const despesasPeriodo = cutoff ? Store.Despesas.getAll().filter(d => d.data >= cutoff).reduce((s,d)=>s+(d.valor||0),0) : 0;
    const manutPeriodo = cutoff ? Store.Manutencoes.getAll().filter(m => m.data >= cutoff).reduce((s,m)=>s+(m.valor||0),0) : 0;

    goalBox.innerHTML = `
      <p><strong>Projeção semanal:</strong> ${Calc.fmtMoney(avgDia*7)} &nbsp;|&nbsp;
         <strong>Projeção mensal:</strong> ${Calc.fmtMoney(avgDia*30)} &nbsp;|&nbsp;
         <strong>Projeção anual:</strong> ${Calc.fmtMoney(avgDia*365)}</p>
      <p><strong>Meta necessária:</strong> ${Calc.fmtMoney(metaDiaria)}/dia · ${Calc.fmtMoney(metaSemanal)}/semana · ${Calc.fmtMoney(metaMensal)}/mês para cobrir despesas fixas.</p>
      <p><strong>Dias de trabalho necessários</strong> no ritmo atual para cobrir a meta mensal: ${diasParaMeta === Infinity ? 'indeterminado (lucro médio ≤ 0)' : diasParaMeta + ' dias'}.</p>
      <p style="color:var(--text-dim);font-size:.82rem">Despesas avulsas no período: ${Calc.fmtMoney(despesasPeriodo)} · Manutenção no período: ${Calc.fmtMoney(manutPeriodo)} — informativo, já não entra no lucro líquido acima.</p>
    `;
  }

  /* ---------- config ---------- */
  function initConfig(){
    const cfg = Store.getConfig();
    document.getElementById('c_aluguel').value = cfg.aluguel || 0;
    document.getElementById('c_terreno').value = cfg.terreno || 0;
    document.getElementById('c_alimentacaoFixa').value = cfg.alimentacaoFixa || 0;
    document.getElementById('c_energia').value = cfg.energia || 0;
    document.getElementById('c_internet').value = cfg.internet || 0;
    document.getElementById('c_telefone').value = cfg.telefone || 0;
    document.getElementById('c_financiamento').value = cfg.financiamento || 0;
    document.getElementById('c_outrasContas').value = cfg.outrasContas || 0;

    document.getElementById('configForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const newCfg = {
        aluguel: Number(document.getElementById('c_aluguel').value)||0,
        terreno: Number(document.getElementById('c_terreno').value)||0,
        alimentacaoFixa: Number(document.getElementById('c_alimentacaoFixa').value)||0,
        energia: Number(document.getElementById('c_energia').value)||0,
        internet: Number(document.getElementById('c_internet').value)||0,
        telefone: Number(document.getElementById('c_telefone').value)||0,
        financiamento: Number(document.getElementById('c_financiamento').value)||0,
        outrasContas: Number(document.getElementById('c_outrasContas').value)||0,
      };
      try {
        setMsg('configMsg', 'Salvando...', false);
        await Store.saveConfig(newCfg);
        setMsg('configMsg', 'Configurações salvas.', false);
        refreshAll();
      } catch(err){
        console.error(err);
        setMsg('configMsg', 'Não foi possível salvar na nuvem. Tente de novo.', true);
      }
    });

    document.getElementById('wipeBtn').addEventListener('click', async () => {
      if (confirm('Isto vai apagar TODOS os lançamentos salvos na nuvem. Confirma?')){
        try {
          await Store.deleteAllEntries();
          refreshAll();
          renderHistory();
        } catch(err){
          console.error(err);
          alert('Não foi possível apagar os dados na nuvem. Verifique sua internet e tente de novo.');
        }
      }
    });
  }

  /* ---------- importação única dos dados antigos (localStorage → nuvem) ---------- */
  function initImportLocal(){
    document.getElementById('importLocalBtn').addEventListener('click', async () => {
      const oldEntries = readOldLs(OLD_LS_ENTRIES);
      const oldDespesas = readOldLs(OLD_LS_DESPESAS);
      const oldManut = readOldLs(OLD_LS_MANUT);
      let oldConfig = null;
      try { oldConfig = JSON.parse(localStorage.getItem(OLD_LS_CONFIG)); } catch(e){ oldConfig = null; }

      if (oldEntries.length === 0 && oldDespesas.length === 0 && oldManut.length === 0 && !oldConfig){
        setMsg('importMsg', 'Nenhum dado antigo encontrado neste navegador.', true);
        return;
      }

      if (!confirm(`Encontrei ${oldEntries.length} lançamento(s), ${oldDespesas.length} despesa(s) e ${oldManut.length} manutenção(ões) salvos neste navegador. Importar tudo pra sua conta na nuvem agora?`)) return;

      document.getElementById('importLocalBtn').disabled = true;
      setMsg('importMsg', 'Importando...', false);
      try {
        for (const entry of oldEntries) await Store.upsertEntry(entry);
        for (const d of oldDespesas) await Store.Despesas.upsert(d);
        for (const m of oldManut) await Store.Manutencoes.upsert(m);
        // Só sobrescreve a configuração da nuvem se ela ainda estiver zerada —
        // não quero apagar despesas fixas que você já tenha configurado na nuvem.
        if (oldConfig){
          const cur = Store.getConfig();
          const curIsEmpty = Object.values(cur).every(v => !v);
          if (curIsEmpty) await Store.saveConfig(oldConfig);
        }
        setMsg('importMsg', `Importado: ${oldEntries.length} lançamento(s), ${oldDespesas.length} despesa(s), ${oldManut.length} manutenção(ões).`, false);
        refreshAll();
      } catch(err){
        console.error(err);
        setMsg('importMsg', 'Deu erro no meio da importação. Pode clicar de novo — o que já foi enviado não duplica.', true);
      } finally {
        document.getElementById('importLocalBtn').disabled = false;
      }
    });
  }
  function readOldLs(key){
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch(e){ return []; }
  }

  function refreshAll(){
    renderDashboard();
    renderHistory();
    renderConfigEntries();
    renderDespesas();
    renderManutencoes();
  }

  /* ---------- despesas (cadastro de despesas avulsas: acessórios, peças, outros) ---------- */
  let editingDespesaId = null;

  function readDespesaForm(){
    const g = id => document.getElementById(id);
    return {
      id: g('dp_id').value || 'desp_' + Date.now(),
      data: g('dp_data').value,
      hora: g('dp_hora').value,
      categoria: g('dp_categoria').value,
      valor: Number(g('dp_valor').value)||0,
      descricao: g('dp_descricao').value,
      loja: g('dp_loja').value,
      obs: g('dp_obs').value
    };
  }
  function fillDespesaForm(e){
    const g = id => document.getElementById(id);
    g('dp_id').value = e.id; g('dp_data').value = e.data; g('dp_hora').value = e.hora;
    g('dp_categoria').value = e.categoria; g('dp_valor').value = e.valor;
    g('dp_descricao').value = e.descricao; g('dp_loja').value = e.loja||''; g('dp_obs').value = e.obs||'';
    editingDespesaId = e.id;
    document.getElementById('dpCancelBtn').style.display = 'inline-block';
    document.getElementById('dpSubmitBtn').textContent = 'Atualizar despesa';
  }
  function clearDespesaForm(){
    document.getElementById('despesaForm').reset();
    document.getElementById('dp_id').value = '';
    document.getElementById('dp_data').value = new Date().toISOString().slice(0,10);
    document.getElementById('dp_hora').value = new Date().toTimeString().slice(0,5);
    document.getElementById('dp_valor').value = 0;
    editingDespesaId = null;
    document.getElementById('dpCancelBtn').style.display = 'none';
    document.getElementById('dpSubmitBtn').textContent = 'Salvar despesa';
  }
  const CAT_LABELS = { acessorio:'Acessório', peca:'Peça', documentacao:'Documentação/Seguro', outro:'Outro' };

  function initDespesas(){
    clearDespesaForm();
    document.getElementById('despesaForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const item = readDespesaForm();
      const wasEditing = !!editingDespesaId;
      try {
        setMsg('dpMsg', 'Salvando...', false);
        await Store.Despesas.upsert(item);
        setMsg('dpMsg', wasEditing ? 'Despesa atualizada.' : 'Despesa salva.', false);
        clearDespesaForm();
        renderDespesas();
      } catch(err){
        console.error(err);
        setMsg('dpMsg', 'Não foi possível salvar na nuvem. Tente de novo.', true);
      }
    });
    document.getElementById('dpCancelBtn').addEventListener('click', clearDespesaForm);
    document.getElementById('dpSearch').addEventListener('input', renderDespesas);
  }

  function renderDespesas(){
    const bodyEl = document.getElementById('dpBody');
    if (!bodyEl) return;
    const q = (document.getElementById('dpSearch').value || '').toLowerCase();
    const list = Store.Despesas.getAll().slice().reverse().filter(e =>
      !q || e.data.includes(q) || (CAT_LABELS[e.categoria]||'').toLowerCase().includes(q) || (e.loja||'').toLowerCase().includes(q)
    );
    const total = Store.Despesas.getAll().reduce((s,e)=>s+(e.valor||0),0);
    document.getElementById('dpTotalPill').textContent = 'Total: ' + Calc.fmtMoney(total);
    if (list.length === 0){
      bodyEl.innerHTML = `<tr><td colspan="7" style="color:var(--text-dim)">Nenhuma despesa registrada ainda.</td></tr>`;
      return;
    }
    bodyEl.innerHTML = list.map(e => `<tr>
      <td>${e.data.split('-').reverse().join('/')}</td>
      <td>${e.hora||'-'}</td>
      <td>${CAT_LABELS[e.categoria]||e.categoria}</td>
      <td>${e.descricao||''}</td>
      <td>${e.loja||'-'}</td>
      <td>${Calc.fmtMoney(e.valor)}</td>
      <td class="row-actions">
        <button data-store="despesas" data-act="edit" data-id="${e.id}" title="Editar">✎</button>
        <button data-store="despesas" data-act="del" data-id="${e.id}" title="Excluir">🗑</button>
      </td>
    </tr>`).join('');
  }

  /* ---------- manutenção da moto (peças trocadas, serviços, oficina, mecânico) ---------- */
  let editingManutId = null;
  const TIPO_LABELS = { oleo:'Troca de óleo', pneus:'Pneus', pastilhas:'Pastilhas de freio', relacao:'Relação', revisao:'Revisão', peca:'Peça trocada', acessorio:'Acessório', outro:'Outro' };

  function readManutForm(){
    const g = id => document.getElementById(id);
    return {
      id: g('mn_id').value || 'manu_' + Date.now(),
      data: g('mn_data').value,
      hora: g('mn_hora').value,
      tipo: g('mn_tipo').value,
      valor: Number(g('mn_valor').value)||0,
      descricao: g('mn_descricao').value,
      oficina: g('mn_oficina').value,
      mecanico: g('mn_mecanico').value,
      hodometro: Number(g('mn_hodometro').value)||0,
      obs: g('mn_obs').value
    };
  }
  function fillManutForm(e){
    const g = id => document.getElementById(id);
    g('mn_id').value = e.id; g('mn_data').value = e.data; g('mn_hora').value = e.hora;
    g('mn_tipo').value = e.tipo; g('mn_valor').value = e.valor; g('mn_descricao').value = e.descricao;
    g('mn_oficina').value = e.oficina||''; g('mn_mecanico').value = e.mecanico||'';
    g('mn_hodometro').value = e.hodometro||''; g('mn_obs').value = e.obs||'';
    editingManutId = e.id;
    document.getElementById('mnCancelBtn').style.display = 'inline-block';
    document.getElementById('mnSubmitBtn').textContent = 'Atualizar manutenção';
  }
  function clearManutForm(){
    document.getElementById('manutForm').reset();
    document.getElementById('mn_id').value = '';
    document.getElementById('mn_data').value = new Date().toISOString().slice(0,10);
    document.getElementById('mn_hora').value = new Date().toTimeString().slice(0,5);
    document.getElementById('mn_valor').value = 0;
    editingManutId = null;
    document.getElementById('mnCancelBtn').style.display = 'none';
    document.getElementById('mnSubmitBtn').textContent = 'Salvar manutenção';
  }

  function initManutencao(){
    clearManutForm();
    document.getElementById('manutForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const item = readManutForm();
      const wasEditing = !!editingManutId;
      try {
        setMsg('mnMsg', 'Salvando...', false);
        await Store.Manutencoes.upsert(item);
        setMsg('mnMsg', wasEditing ? 'Manutenção atualizada.' : 'Manutenção salva.', false);
        clearManutForm();
        renderManutencoes();
      } catch(err){
        console.error(err);
        setMsg('mnMsg', 'Não foi possível salvar na nuvem. Tente de novo.', true);
      }
    });
    document.getElementById('mnCancelBtn').addEventListener('click', clearManutForm);
    document.getElementById('mnSearch').addEventListener('input', renderManutencoes);
  }

  function renderManutencoes(){
    const bodyEl = document.getElementById('mnBody');
    if (!bodyEl) return;
    const q = (document.getElementById('mnSearch').value || '').toLowerCase();
    const list = Store.Manutencoes.getAll().slice().reverse().filter(e =>
      !q || e.data.includes(q) || (TIPO_LABELS[e.tipo]||'').toLowerCase().includes(q) ||
      (e.oficina||'').toLowerCase().includes(q) || (e.mecanico||'').toLowerCase().includes(q)
    );
    const total = Store.Manutencoes.getAll().reduce((s,e)=>s+(e.valor||0),0);
    document.getElementById('mnTotalPill').textContent = 'Total: ' + Calc.fmtMoney(total);
    if (list.length === 0){
      bodyEl.innerHTML = `<tr><td colspan="8" style="color:var(--text-dim)">Nenhuma manutenção registrada ainda.</td></tr>`;
      return;
    }
    bodyEl.innerHTML = list.map(e => `<tr>
      <td>${e.data.split('-').reverse().join('/')}</td>
      <td>${e.hora||'-'}</td>
      <td>${TIPO_LABELS[e.tipo]||e.tipo}</td>
      <td>${e.descricao||''}</td>
      <td>${e.oficina||'-'}</td>
      <td>${e.mecanico||'-'}</td>
      <td>${Calc.fmtMoney(e.valor)}</td>
      <td class="row-actions">
        <button data-store="manutencao" data-act="edit" data-id="${e.id}" title="Editar">✎</button>
        <button data-store="manutencao" data-act="del" data-id="${e.id}" title="Excluir">🗑</button>
      </td>
    </tr>`).join('');
  }

  return { init };
})();

/* ============================== AUTH ===================================== */
const Auth = (() => {
  function showAuthScreen(){
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appRoot').style.display = 'none';
  }
  function showApp(){
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appRoot').style.display = 'flex';
  }
  function setAuthMsg(text, isError){
    const el = document.getElementById('authMsg');
    el.textContent = text;
    el.style.color = isError ? 'var(--danger)' : 'var(--accent-2)';
  }
  function setLoading(isLoading){
    document.getElementById('authSignInBtn').disabled = isLoading;
    document.getElementById('authSignUpBtn').disabled = isLoading;
  }
  function traduzErro(msg){
    if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
    if (/User already registered/i.test(msg)) return 'Já existe uma conta com esse e-mail. Tente entrar.';
    if (/Password should be/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/Email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).';
    return msg;
  }

  // Depois do login: busca os dados na nuvem e só então mostra o app.
  async function bootApp(){
    try {
      setAuthMsg('Carregando seus dados da nuvem...', false);
      await Store.loadAll();
      showApp();
      UI.init();
    } catch(err){
      console.error(err);
      showAuthScreen();
      setAuthMsg('Não foi possível carregar seus dados. Verifique sua internet e tente de novo.', true);
    }
  }

  function init(){
    document.getElementById('authForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const email = document.getElementById('auth_email').value.trim();
      const password = document.getElementById('auth_password').value;
      setLoading(true);
      setAuthMsg('Entrando...', false);
      const { error } = await sbClient.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error){ setAuthMsg(traduzErro(error.message), true); return; }
      await bootApp();
    });

    document.getElementById('authSignUpBtn').addEventListener('click', async () => {
      const email = document.getElementById('auth_email').value.trim();
      const password = document.getElementById('auth_password').value;
      if (!email || !password){ setAuthMsg('Preencha e-mail e senha para criar a conta.', true); return; }
      if (password.length < 6){ setAuthMsg('A senha precisa ter pelo menos 6 caracteres.', true); return; }
      setLoading(true);
      setAuthMsg('Criando conta...', false);
      const { data, error } = await sbClient.auth.signUp({ email, password });
      setLoading(false);
      if (error){ setAuthMsg(traduzErro(error.message), true); return; }
      if (data.session){
        await bootApp();
      } else {
        setAuthMsg('Conta criada! Verifique seu e-mail para confirmar antes de entrar.', false);
      }
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await sbClient.auth.signOut();
      location.reload();
    });

    // Login já feito antes (sessão salva pelo navegador) — entra direto, sem pedir de novo.
    sbClient.auth.getSession().then(({ data }) => {
      if (data.session) bootApp();
      else showAuthScreen();
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Auth.init);
