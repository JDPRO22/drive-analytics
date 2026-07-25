/* ==========================================================================
   DRIVE ANALYTICS — script.js
   Vanilla JS, no framework. Organized in logical modules via IIFE namespaces.
   Persistence: localStorage only (see risk note shown in Configurações).
   ========================================================================== */

const LS_ENTRIES = 'da_entries_v1';
const LS_CONFIG  = 'da_config_v1';
const LS_THEME   = 'da_theme_v1';

/* ============================== STORE =================================== */
const Store = (() => {
  function getEntries(){
    try { return JSON.parse(localStorage.getItem(LS_ENTRIES)) || []; }
    catch(e){ return []; }
  }
  function saveEntries(list){ localStorage.setItem(LS_ENTRIES, JSON.stringify(list)); }

  function upsertEntry(entry){
    const list = getEntries();
    const idx = list.findIndex(e => e.id === entry.id);
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    list.sort((a,b) => a.data.localeCompare(b.data));
    saveEntries(list);
  }
  function deleteEntry(id){
    saveEntries(getEntries().filter(e => e.id !== id));
  }
  function getConfig(){
    try { return JSON.parse(localStorage.getItem(LS_CONFIG)) || defaultConfig(); }
    catch(e){ return defaultConfig(); }
  }
  function saveConfig(cfg){ localStorage.setItem(LS_CONFIG, JSON.stringify(cfg)); }
  function defaultConfig(){
    return { aluguel:0, terreno:0, alimentacaoFixa:0, energia:0, internet:0, telefone:0, financiamento:0, outrasContas:0 };
  }
  return { getEntries, saveEntries, upsertEntry, deleteEntry, getConfig, saveConfig };
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

  function metrics(e){
    const kmRodados = Math.max(0, (e.hodFim||0) - (e.hodIni||0));
    const litros = e.litros > 0 ? e.litros : (e.precoLitro > 0 ? (e.valorComb / e.precoLitro) : 0);
    const kmL = litros > 0 ? kmRodados / litros : 0;

    const receitaBruta = (e.fatUber||0)+(e.fat99||0)+(e.gorjetas||0)+(e.promocoes||0)+(e.extras||0);
    const taxaUberValor = (e.fatUber||0) * (e.taxaUber||0) / 100;
    const taxa99Valor   = (e.fat99||0) * (e.taxa99||0) / 100;
    const custoManutencao = (e.mOleo||0)+(e.mRelacao||0)+(e.mPneus||0)+(e.mPastilhas||0)+(e.mRevisao||0);

    const custosTotais = taxaUberValor + taxa99Valor + (e.alimentacao||0) + (e.estacionamento||0) +
                          (e.lavagem||0) + (e.oleoCusto||0) + (e.outros||0) + custoManutencao + (e.valorComb||0);

    const receitaLiquida = receitaBruta - (taxaUberValor + taxa99Valor);
    const lucroLiquido = receitaBruta - custosTotais;

    const custoPorKm  = kmRodados > 0 ? custosTotais / kmRodados : 0;
    const valorPorKm   = kmRodados > 0 ? receitaBruta / kmRodados : 0;
    const lucroPorKm   = kmRodados > 0 ? lucroLiquido / kmRodados : 0;

    const tempoOnlineMin = minutesBetween(e.inicio, e.fim);
    const tempoTrabalhandoMin = Math.max(0, tempoOnlineMin - (e.parado||0));
    const horasTrabalhadas = tempoTrabalhandoMin / 60;

    const valorMedioCorrida = e.corridas > 0 ? receitaBruta / e.corridas : 0;
    const lucroMedioCorrida = e.corridas > 0 ? lucroLiquido / e.corridas : 0;
    const corridasPorHora   = horasTrabalhadas > 0 ? e.corridas / horasTrabalhadas : 0;
    const receitaPorHora    = horasTrabalhadas > 0 ? receitaBruta / horasTrabalhadas : 0;
    const lucroPorHora      = horasTrabalhadas > 0 ? lucroLiquido / horasTrabalhadas : 0;
    const tempoMedioCorridaMin = e.corridas > 0 ? tempoTrabalhandoMin / e.corridas : 0;

    const pctCombustivel = custosTotais > 0 ? (e.valorComb||0) / custosTotais * 100 : 0;
    const pctTaxas        = custosTotais > 0 ? (taxaUberValor+taxa99Valor) / custosTotais * 100 : 0;
    const pctManutencao   = custosTotais > 0 ? custoManutencao / custosTotais * 100 : 0;

    return {
      kmRodados, litros, kmL, receitaBruta, receitaLiquida, lucroLiquido, custosTotais,
      custoPorKm, valorPorKm, lucroPorKm, tempoOnlineMin, tempoTrabalhandoMin, horasTrabalhadas,
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

  return { metrics, fmtMoney, fmtNum, minutesBetween };
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
    }

    list.push({ text: todayMetrics.lucroLiquido > 0 ? 'Hoje compensou trabalhar — resultado líquido positivo.' : 'Hoje não compensou trabalhar — o resultado líquido foi negativo ou nulo.', warn: todayMetrics.lucroLiquido <= 0 });

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
    document.getElementById('todayPill').textContent = new Date().toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'short' });
    document.getElementById('f_data').value = new Date().toISOString().slice(0,10);
    refreshAll();
    document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('is-open'));
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
        const titles = { dashboard:'Painel do dia', lancamento:'Novo lançamento', historico:'Histórico', relatorios:'Relatórios', config:'Configurações' };
        document.getElementById('viewTitle').textContent = titles[btn.dataset.view];
        document.getElementById('sidebar').classList.remove('is-open');
        if (btn.dataset.view === 'relatorios') renderReports('daily');
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
      parado: Number(g('f_parado').value)||0,
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
    g('f_inicio').value = e.inicio; g('f_fim').value = e.fim; g('f_parado').value = e.parado;
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
    document.getElementById('f_taxaUber').value = 25;
    document.getElementById('f_taxa99').value = 18;
    editingId = null;
    document.getElementById('cancelEditBtn').style.display = 'none';
    document.getElementById('submitBtn').textContent = 'Salvar lançamento';
  }

  function initForm(){
    document.getElementById('entryForm').addEventListener('submit', ev => {
      ev.preventDefault();
      const entry = readForm();
      if (entry.hodFim <= entry.hodIni){
        setMsg('formMsg', 'Hodômetro final deve ser maior que o inicial.', true);
        return;
      }
      Store.upsertEntry(entry);
      setMsg('formMsg', 'Lançamento salvo.', false);
      clearForm();
      refreshAll();
      document.querySelector('.nav-item[data-view="dashboard"]').click();
    });
    document.getElementById('cancelEditBtn').addEventListener('click', clearForm);
  }

  function setMsg(id, text, isError){
    const el = document.getElementById(id);
    el.textContent = text;
    el.style.color = isError ? 'var(--danger)' : 'var(--accent-2)';
    setTimeout(() => el.textContent = '', 3500);
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

    body.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const entry = Store.getEntries().find(e => e.id === id);
      if (!entry) return;
      if (btn.dataset.act === 'edit'){
        fillForm(entry);
        document.querySelector('.nav-item[data-view="lancamento"]').click();
      } else if (btn.dataset.act === 'dup'){
        const copy = Object.assign({}, entry, { id:'e_'+Date.now(), data:new Date().toISOString().slice(0,10) });
        Store.upsertEntry(copy);
        refreshAll();
      } else if (btn.dataset.act === 'del'){
        if (confirm('Excluir este lançamento? Esta ação não pode ser desfeita.')){
          Store.deleteEntry(id);
          refreshAll();
        }
      }
    }));
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
        LucroPorKm:m.lucroPorKm.toFixed(2), CorridasPorHora:m.corridasPorHora.toFixed(2)
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

    goalBox.innerHTML = `
      <p><strong>Projeção semanal:</strong> ${Calc.fmtMoney(avgDia*7)} &nbsp;|&nbsp;
         <strong>Projeção mensal:</strong> ${Calc.fmtMoney(avgDia*30)} &nbsp;|&nbsp;
         <strong>Projeção anual:</strong> ${Calc.fmtMoney(avgDia*365)}</p>
      <p><strong>Meta necessária:</strong> ${Calc.fmtMoney(metaDiaria)}/dia · ${Calc.fmtMoney(metaSemanal)}/semana · ${Calc.fmtMoney(metaMensal)}/mês para cobrir despesas fixas.</p>
      <p><strong>Dias de trabalho necessários</strong> no ritmo atual para cobrir a meta mensal: ${diasParaMeta === Infinity ? 'indeterminado (lucro médio ≤ 0)' : diasParaMeta + ' dias'}.</p>
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

    document.getElementById('configForm').addEventListener('submit', ev => {
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
      Store.saveConfig(newCfg);
      setMsg('configMsg', 'Configurações salvas.', false);
      refreshAll();
    });

    document.getElementById('wipeBtn').addEventListener('click', () => {
      if (confirm('Isto vai apagar TODOS os lançamentos salvos neste navegador. Confirma?')){
        localStorage.removeItem(LS_ENTRIES);
        refreshAll();
        renderHistory();
      }
    });
  }

  function refreshAll(){
    renderDashboard();
    renderHistory();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', UI.init);
