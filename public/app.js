/**
 * Dashboard DARK Store — Frontend Application
 * Charts empresariais com Chart.js + DataLabels + Datas Reais + Filtro Calendário D-1 + Tabela Comparativa MoM
 */

// ============================================================
// Chart.js Global Defaults
// ============================================================
Chart.register(ChartDataLabels);
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#8b92a5';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(13, 15, 26, 0.95)';
Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: '600' };
Chart.defaults.plugins.tooltip.bodyFont = { size: 11 };
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.elements.bar.borderRadius = 4;
Chart.defaults.elements.line.tension = 0.25;

// Configuração de Escala Padrão Segura para Chart.js v4
const SCALE_CONFIG_X = {
  display: true,
  grid: {
    display: true,
    color: 'rgba(255, 255, 255, 0.05)',
    drawOnChartArea: true,
  },
  border: {
    display: true,
    color: 'rgba(99, 102, 241, 0.4)',
    width: 2,
  },
  ticks: {
    display: true,
    color: '#f0f2f5',
    font: { size: 11, weight: '600', family: "'Inter', sans-serif" },
    maxRotation: 45,
    minRotation: 0,
    autoSkip: false,
    padding: 6,
  },
};

const SCALE_CONFIG_Y = {
  display: true,
  grid: {
    display: true,
    color: 'rgba(255, 255, 255, 0.05)',
  },
  border: {
    display: true,
    color: 'rgba(255, 255, 255, 0.15)',
    width: 1,
  },
  ticks: {
    display: true,
    color: '#8b92a5',
    font: { size: 10 },
    padding: 6,
  },
};

// ============================================================
// Color Palette
// ============================================================
const COLORS = {
  blue: '#6366f1', blueLight: '#818cf8', blueBg: 'rgba(99,102,241,0.15)',
  green: '#10b981', greenLight: '#34d399', greenBg: 'rgba(16,185,129,0.15)',
  orange: '#f59e0b', orangeLight: '#fbbf24', orangeBg: 'rgba(245,158,11,0.15)',
  red: '#ef4444', redLight: '#f87171', redBg: 'rgba(239,68,68,0.15)',
  cyan: '#22d3ee', cyanBg: 'rgba(34,211,238,0.15)',
  purple: '#8b5cf6', purpleLight: '#a78bfa', purpleBg: 'rgba(139,92,246,0.15)',
  pink: '#ec4899', pinkLight: '#f472b6', pinkBg: 'rgba(236,72,153,0.15)',
  gray: '#64748b', grayBg: 'rgba(100,116,139,0.12)',
  gradient: (ctx, c1, c2) => {
    const g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    return g;
  },
};

const CHANNEL_COLORS = [
  '#6366f1', '#8b5cf6', '#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#3b82f6', '#14b8a6'
];

// ============================================================
// Formatters
// ============================================================
const fmt = {
  currency: (v) => v == null ? '—' : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  currencyK: (v) => v == null ? '—' : 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)),
  number: (v) => v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }),
  decimal: (v, d = 1) => v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }),
  pct: (v) => v == null ? '—' : v.toFixed(1) + '%',
};

// ============================================================
// Chart Registry
// ============================================================
const charts = {};

function destroyChart(id) {
  if (charts[id]) {
    try { charts[id].destroy(); } catch (e) {}
    delete charts[id];
  }
}

// ============================================================
// Application Core
// ============================================================
const App = {
  data: null,
  currentMonth: null,
  currentStartDay: 1,
  currentCutoffDay: null,
  selectedGrupo: 'TODOS',
  selectedLinha: 'TODOS',
  selectedSubgrupo: 'TODOS',
  viewMode: 'dia', // 'dia' ou 'semana'

  async init() {
    await this.loadData();
    // Verifica atualizações a cada 1 hora (sincronização diária agendada para 07:45 no servidor)
    setInterval(() => this.loadData(this.currentMonth, this.currentCutoffDay, this.currentStartDay), 60 * 60 * 1000);
  },

  async forceRefresh() {
    const btn = document.getElementById('btnRefresh');
    if (btn) btn.classList.add('spinning');
    try {
      await fetch('/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mes: this.currentMonth }) });
      await this.loadData(this.currentMonth, this.currentCutoffDay, this.currentStartDay);
    } catch (e) {
      console.error('Erro ao forçar atualização:', e);
    } finally {
      if (btn) btn.classList.remove('spinning');
    }
  },

  toggleViewMode() {
    this.viewMode = this.viewMode === 'dia' ? 'semana' : 'dia';
    const optDia = document.getElementById('optDia');
    const optSemana = document.getElementById('optSemana');
    if (optDia && optSemana) {
      optDia.classList.toggle('active', this.viewMode === 'dia');
      optSemana.classList.toggle('active', this.viewMode === 'semana');
    }
    this.render();
  },

  async loadData(mes, diaAte, diaDe, dataInicio, dataFim) {
    try {
      let url = '/api/dashboard';
      const params = [];
      if (mes) params.push(`mes=${mes}`);
      if (diaAte) params.push(`diaAte=${diaAte}`);
      if (diaDe) params.push(`diaDe=${diaDe}`);
      if (dataInicio) params.push(`dataInicio=${dataInicio}`);
      if (dataFim) params.push(`dataFim=${dataFim}`);
      if (this.selectedGrupo && this.selectedGrupo !== 'TODOS') params.push(`grupo=${encodeURIComponent(this.selectedGrupo)}`);
      if (this.selectedLinha && this.selectedLinha !== 'TODOS') params.push(`linha=${encodeURIComponent(this.selectedLinha)}`);
      if (this.selectedSubgrupo && this.selectedSubgrupo !== 'TODOS') params.push(`subgrupo=${encodeURIComponent(this.selectedSubgrupo)}`);

      if (params.length > 0) url += `?${params.join('&')}`;

      const resp = await fetch(url);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error);

      this.data = json.data;
      this.currentMonth = json.data.mesAno;
      this.currentStartDay = json.data.diaDe || 1;
      this.currentCutoffDay = json.data.diaCorte;
      this.currentDataInicio = dataInicio;
      this.currentDataFim = dataFim;
      this.render();
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    } finally {
      document.getElementById('loading').classList.add('hidden');
    }
  },

  onFilterCategoryChange() {
    const selGrupo = document.getElementById('filterGrupo')?.value || 'TODOS';
    const selLinha = document.getElementById('filterLinha')?.value || 'TODOS';
    const selSubgrupo = document.getElementById('filterSubgrupo')?.value || 'TODOS';

    this.selectedGrupo = selGrupo;
    this.selectedLinha = selLinha;
    this.selectedSubgrupo = selSubgrupo;

    document.getElementById('loading').classList.remove('hidden');
    this.loadData(this.currentMonth, this.currentCutoffDay, this.currentStartDay, this.currentDataInicio, this.currentDataFim);
  },

  clearCategoryFilters() {
    this.selectedGrupo = 'TODOS';
    this.selectedLinha = 'TODOS';
    this.selectedSubgrupo = 'TODOS';

    if (document.getElementById('filterGrupo')) document.getElementById('filterGrupo').value = 'TODOS';
    if (document.getElementById('filterLinha')) document.getElementById('filterLinha').value = 'TODOS';
    if (document.getElementById('filterSubgrupo')) document.getElementById('filterSubgrupo').value = 'TODOS';

    document.getElementById('loading').classList.remove('hidden');
    this.loadData(this.currentMonth, this.currentCutoffDay, this.currentStartDay, this.currentDataInicio, this.currentDataFim);
  },

  onPresetChange(preset) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    let startStr, endStr;

    if (preset === 'all') {
      startStr = '2026-05-18'; // Início do histórico da Dark Store
      endStr = todayStr;
    } else if (preset === 'current_month') {
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      startStr = `${year}-${month}-01`;
      endStr = todayStr;
    } else if (preset === 'last_30') {
      const d30 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      startStr = d30.toISOString().split('T')[0];
      endStr = todayStr;
    } else if (preset === 'last_7') {
      const d7 = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      startStr = d7.toISOString().split('T')[0];
      endStr = todayStr;
    }

    if (startStr && endStr) {
      const dateStartEl = document.getElementById('dateStart');
      const dateEndEl = document.getElementById('dateEnd');
      if (dateStartEl) dateStartEl.value = startStr;
      if (dateEndEl) dateEndEl.value = endStr;
      this.onDateRangeChange();
    }
  },

  onDateRangeChange() {
    const startStr = document.getElementById('dateStart')?.value;
    const endStr = document.getElementById('dateEnd')?.value;

    if (!startStr || !endStr) return;

    const startParts = startStr.split('-');
    const endParts = endStr.split('-');

    if (startParts.length === 3 && endParts.length === 3) {
      const yearMonth = `${startParts[0]}-${startParts[1]}`;
      const dayStart = parseInt(startParts[2]);
      const dayEnd = parseInt(endParts[2]);

      document.getElementById('loading').classList.remove('hidden');
      this.loadData(yearMonth, dayEnd, dayStart, startStr, endStr);
    }
  },

  switchCategoryTab(tab) {
    const tabs = ['groups', 'lines', 'subgroups'];
    tabs.forEach(t => {
      const content = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      const btn = document.getElementById(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (t === tab) {
        if (content) content.style.display = 'block';
        if (btn) btn.classList.add('active');
      } else {
        if (content) content.style.display = 'none';
        if (btn) btn.classList.remove('active');
      }
    });
  },

  render() {
    const d = this.data;
    if (!d) return;

    this.renderHeader(d);
    this.renderKPIs(d);
    this.renderGrowth(d);
    this.renderCustomerEfficiency(d);
    this.renderDailyChart(d);
    this.renderAcumuladoChart(d);
    this.renderChannels(d);
    this.renderWeekdayCharts(d);
    this.renderCategories(d);
    this.renderLines(d);
    this.renderSubgroups(d);
  },

  // ============================================================
  // Header Render
  // ============================================================
  renderHeader(d) {
    const monthSelect = document.getElementById('monthSelect');
    const meses = d.mesesDisponiveis || [];
    if (!meses.includes(d.mesAno)) meses.push(d.mesAno);
    meses.sort();

    monthSelect.innerHTML = meses.map(m => {
      const [y, mo] = m.split('-');
      const names = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      return `<option value="${m}" ${m === d.mesAno ? 'selected' : ''}>${names[parseInt(mo)]} ${y}</option>`;
    }).join('');

    const dateStart = document.getElementById('dateStart');
    const dateEnd = document.getElementById('dateEnd');
    if (dateStart && dateEnd) {
      const startDayFormatted = String(d.diaDe || 1).padStart(2, '0');
      const endDayFormatted = String(d.diaCorte).padStart(2, '0');
      dateStart.value = `${d.mesAno}-${startDayFormatted}`;
      dateEnd.value = `${d.mesAno}-${endDayFormatted}`;
    }

    const optDia = document.getElementById('optDia');
    const optSemana = document.getElementById('optSemana');
    if (optDia && optSemana) {
      optDia.classList.toggle('active', this.viewMode === 'dia');
      optSemana.classList.toggle('active', this.viewMode === 'semana');
    }

    // Atualiza opções dos dropdowns de filtros de categoria
    this.updateCategoryFilterDropdowns(d);

    const [y, mo] = d.mesAno.split('-');
    const monthNamesStr = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const monthFormatted = `${monthNamesStr[parseInt(mo)]}/${y}`;
    const startDayFmt = String(d.diaDe || 1).padStart(2, '0');
    const dayCorteFormatted = String(d.diaCorte).padStart(2, '0');
    
    let infoText = `Exibindo histórico de ${startDayFmt}/${monthFormatted} até ${dayCorteFormatted}/${monthFormatted} (${this.viewMode === 'semana' ? 'Visão Semanal' : 'Visão Diária'})`;
    if (d.isD1Default) {
      infoText += ` (Filtro padrão D-1 - Ontem)`;
    } else if (d.diaCorte === d.diaHoje) {
      infoText += ` (Incluindo vendas parciais de Hoje)`;
    }

    const activeFilters = [];
    if (this.selectedGrupo && this.selectedGrupo !== 'TODOS') activeFilters.push(`Grupo: ${this.selectedGrupo}`);
    if (this.selectedLinha && this.selectedLinha !== 'TODOS') activeFilters.push(`Linha: ${this.selectedLinha}`);
    if (this.selectedSubgrupo && this.selectedSubgrupo !== 'TODOS') activeFilters.push(`Subgrupo: ${this.selectedSubgrupo}`);

    if (activeFilters.length > 0) {
      infoText += ` | 🎯 FILTRO ATIVO: [ ${activeFilters.join(' | ')} ]`;
    }
    document.getElementById('filterInfoText').innerHTML = infoText;

    const badge = document.getElementById('statusBadge');
    const statusText = document.getElementById('statusText');

    if (d.qlikConnected) {
      badge.className = 'status-badge connected';
      statusText.textContent = 'Qlik Conectado Live';
    } else {
      badge.className = 'status-badge demo';
      statusText.textContent = 'Modo Demo';
    }

    document.getElementById('demoBanner').classList.toggle('hidden', !d.isDemo);

    if (d.lastUpdate) {
      const dt = new Date(d.lastUpdate);
      document.getElementById('lastUpdate').textContent = `Atualizado às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }

    document.getElementById('mesLabel').textContent = `${monthFormatted} · Intervalo ${startDayFmt} a ${dayCorteFormatted} (Dia ${d.diaHoje} real)`;
  },

  // ============================================================
  // KPIs Executivos
  // ============================================================
  renderKPIs(d) {
    const k = d.kpis;
    this.animateValue('kpiRLValue', k.resultadoLiquido, fmt.currency);
    this.animateValue('kpiMetaOrcValue', k.metaOrcada, fmt.currency);
    this.animateValue('kpiMetaDesValue', k.metaDesafio, fmt.currency);
    this.animateValue('kpiProjecaoValue', k.projecao, fmt.currency);
    this.animateValue('kpiMediaDia', k.mediaDiaria, fmt.currency);

    document.getElementById('kpiRLSub').textContent = `Acumulado em ${k.diasComDados} dias`;
    document.getElementById('kpiProjecaoSub').textContent = `Projeção calculada para ${d.diasNoMes} dias`;
    document.getElementById('kpiMediaDiaSub').textContent = `Média real em ${k.diasComDados} dias`;

    const pctO = k.pctOrcada || 0;
    const pctD = k.pctDesafio || 0;
    document.getElementById('pctOrcLabel').textContent = fmt.pct(pctO);
    document.getElementById('pctOrcBar').style.width = Math.min(pctO, 100) + '%';
    document.getElementById('pctOrcBar').className = `progress-fill ${pctO >= 100 ? 'success' : pctO >= 80 ? 'warning' : 'danger'}`;

    document.getElementById('pctDesLabel').textContent = fmt.pct(pctD);
    document.getElementById('pctDesBar').style.width = Math.min(pctD, 100) + '%';
    document.getElementById('pctDesBar').className = `progress-fill ${pctD >= 100 ? 'success' : pctD >= 80 ? 'warning' : 'danger'}`;
  },

  animateValue(id, value, formatter) {
    const el = document.getElementById(id);
    if (!el || value == null) { if (el) el.textContent = '—'; return; }

    const duration = 1000;
    const start = performance.now();
    const startVal = 0;

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (value - startVal) * eased;
      el.textContent = formatter(current);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  },

  // ============================================================
  // Eficiência Operacional & Perfil do Cliente
  // ============================================================
  renderCustomerEfficiency(d) {
    const k = d.kpis;
    const g = d.crescimento || {};

    this.animateValue('kpiClientes', k.clientes, fmt.number);
    this.animateValue('kpiGastoCliente', k.ticketPorCliente, fmt.currency);
    this.animateValue('kpiTKM', k.ticketMedio, fmt.currency);
    this.animateValue('kpiIPN', k.itensPorNota, (v) => fmt.decimal(v, 1) + ' pçs');
    this.animateValue('kpiIPC', k.itensPorCliente, (v) => fmt.decimal(v, 1) + ' pçs');
    this.animateValue('kpiFreq', k.cuponsPorCliente, (v) => fmt.decimal(v, 2) + ' cupons');

    function getSubText(metricKey, defaultText) {
      const data = g[metricKey];
      if (!data || data.variacao == null) return defaultText;
      const isPos = data.variacao > 0;
      const isNeg = data.variacao < 0;
      const arrow = isPos ? '↑' : isNeg ? '↓' : '→';
      const sign = isPos ? '+' : '';
      return `<span style="color:${isPos ? '#34d399' : isNeg ? '#f87171' : '#a0aec0'};font-weight:700;">${arrow} ${sign}${data.variacao.toFixed(1)}% vs M-1</span> (mesmo período)`;
    }

    document.getElementById('kpiClientesSub').innerHTML = getSubText('clientes', `${fmt.decimal(k.clientes / Math.max(k.diasComDados, 1), 0)} clientes/dia`);
    document.getElementById('kpiGastoClienteSub').innerHTML = getSubText('ticketPorCliente', 'Resultado Líquido / Cliente');
    document.getElementById('kpiTKMSub').innerHTML = getSubText('ticketMedio', 'Resultado Líquido / Cupom');
    document.getElementById('kpiIPNSub').innerHTML = getSubText('itensPorNota', 'Peças / Cupom');
    document.getElementById('kpiIPCSub').innerHTML = getSubText('itensPorCliente', 'Peças / Cliente');
    document.getElementById('kpiFreqSub').innerHTML = getSubText('cuponsPorCliente', 'Cupons / Cliente');

    const isSemana = this.viewMode === 'semana';
    const dataList = isSemana ? (d.weekly || []) : d.daily;
    const trendFiltered = dataList.filter(x => isSemana ? true : (x.dia <= d.diaCorte && x.temDados));
    const labels = trendFiltered.map(x => x.labelCompleto || (isSemana ? x.semanaKey : `Dia ${x.dia}`));

    // 1. Gráfico Eficiência da Nota (TKM vs IPN)
    destroyChart('chartEficienciaNota');
    const ctx1 = document.getElementById('chartEficienciaNota').getContext('2d');

    charts.chartEficienciaNota = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ticket Médio (TKM R$)',
            data: trendFiltered.map(x => x.ticketMedio),
            backgroundColor: 'rgba(245,158,11,0.5)',
            borderColor: 'rgba(245,158,11,0.9)',
            borderWidth: 1.5,
            yAxisID: 'y',
            order: 2,
          },
          {
            label: 'Itens por Nota (IPN)',
            data: trendFiltered.map(x => x.itensPorNota),
            type: 'line',
            borderColor: COLORS.cyan,
            backgroundColor: 'rgba(34,211,238,0.1)',
            borderWidth: 3,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: COLORS.cyan,
            yAxisID: 'y1',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20, bottom: 10, left: 10, right: 10 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          datalabels: {
            display: (ctx) => ctx.datasetIndex === 1,
            anchor: 'end', align: 'top', offset: 2,
            color: COLORS.cyan,
            font: { size: 9, weight: '700', family: "'JetBrains Mono'" },
            formatter: (v) => fmt.decimal(v, 1) + 'pç',
          },
          tooltip: {
            callbacks: {
              title: (c) => `${isSemana ? '📅 Semana' : '📅 Data'}: ${c[0].label}`,
              label: (c) => c.datasetIndex === 0 ? ` Ticket Médio: ${fmt.currency(c.raw)}` : ` Itens por Nota: ${fmt.decimal(c.raw, 1)} pçs`,
            },
          },
        },
        scales: {
          x: SCALE_CONFIG_X,
          y: { ...SCALE_CONFIG_Y, position: 'left', ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => 'R$ ' + v.toFixed(0) } },
          y1: { ...SCALE_CONFIG_Y, position: 'right', grid: { drawOnChartArea: false }, ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => v.toFixed(1) + ' pç' } },
        },
      },
    });

    // 2. Gráfico Valor & Frequência do Cliente
    destroyChart('chartValorCliente');
    const ctx2 = document.getElementById('chartValorCliente').getContext('2d');
    charts.chartValorCliente = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Gasto Médio por Cliente (R$)',
            data: trendFiltered.map(x => x.ticketPorCliente),
            backgroundColor: 'rgba(16,185,129,0.5)',
            borderColor: 'rgba(16,185,129,0.9)',
            borderWidth: 1.5,
            yAxisID: 'y',
            order: 2,
          },
          {
            label: 'Frequência (Cupons/Cliente)',
            data: trendFiltered.map(x => x.cuponsPorCliente),
            type: 'line',
            borderColor: COLORS.pink,
            backgroundColor: 'rgba(236,72,153,0.1)',
            borderWidth: 3,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: COLORS.pink,
            yAxisID: 'y1',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20, bottom: 10, left: 10, right: 10 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          datalabels: {
            display: (ctx) => ctx.datasetIndex === 1,
            anchor: 'end', align: 'top', offset: 2,
            color: COLORS.pinkLight,
            font: { size: 9, weight: '700', family: "'JetBrains Mono'" },
            formatter: (v) => fmt.decimal(v, 2) + 'x',
          },
          tooltip: {
            callbacks: {
              title: (c) => `${isSemana ? '📅 Semana' : '📅 Data'}: ${c[0].label}`,
              label: (c) => c.datasetIndex === 0 ? ` Gasto por Cliente: ${fmt.currency(c.raw)}` : ` Frequência: ${fmt.decimal(c.raw, 2)} cupons/cli`,
            },
          },
        },
        scales: {
          x: SCALE_CONFIG_X,
          y: { ...SCALE_CONFIG_Y, position: 'left', ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => 'R$ ' + v.toFixed(0) } },
          y1: { ...SCALE_CONFIG_Y, position: 'right', grid: { drawOnChartArea: false }, ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => v.toFixed(2) + 'x' } },
        },
      },
    });
  },

  // ============================================================
  // Crescimento MoM (Cards + Tabela Completa do Mesmo Período)
  // ============================================================
  renderGrowth(d) {
    const g = d.crescimento || {};
    const grid = document.getElementById('growthGrid');

    const metrics = [
      { key: 'resultadoLiquido', label: 'Resultado Líquido', fmt: fmt.currencyK },
      { key: 'clientes', label: 'Clientes Únicos', fmt: fmt.number },
      { key: 'cupons', label: 'Cupons Emitidos', fmt: fmt.number },
      { key: 'ticketMedio', label: 'Ticket Médio (TKM)', fmt: fmt.currency },
      { key: 'ticketPorCliente', label: 'Gasto / Cliente', fmt: fmt.currency },
      { key: 'itensPorNota', label: 'Itens / Nota (IPN)', fmt: (v) => fmt.decimal(v, 1) },
    ];

    grid.innerHTML = metrics.map(m => {
      const data = g[m.key] || {};
      const variacao = data.variacao;
      const isPos = variacao > 0;
      const isNeg = variacao < 0;
      const cls = isPos ? 'positive' : isNeg ? 'negative' : 'neutral';
      const arrow = isPos ? '↑' : isNeg ? '↓' : '→';

      return `
        <div class="growth-card animate-in">
          <div class="growth-label">${m.label}</div>
          <div class="growth-values">
            <span class="growth-current">${m.fmt(data.atual)}</span>
          </div>
          <div class="growth-values" style="margin-bottom:6px">
            <span class="growth-previous">Anterior: ${m.fmt(data.anterior)}</span>
          </div>
          <span class="growth-change ${cls}">
            ${arrow} ${variacao != null ? (isPos ? '+' : '') + fmt.decimal(variacao, 1) + '%' : 'N/A'}
          </span>
        </div>
      `;
    }).join('');

    // Atualização dos cabeçalhos e da Tabela Comparativa MoM
    const diaFormatted = String(d.diaCorte).padStart(2, '0');
    document.getElementById('thMesAtual').textContent = `Mês Atual (${d.mesAno} até dia ${diaFormatted})`;
    document.getElementById('thMesAnterior').textContent = `Mês Anterior (${d.mesAnterior} até dia ${diaFormatted})`;

    const momRows = [
      { key: 'resultadoLiquido', label: '💰 Resultado Líquido', fmt: fmt.currency, diffFmt: fmt.currency },
      { key: 'clientes', label: '👥 Clientes Únicos', fmt: fmt.number, diffFmt: (v) => (v > 0 ? '+' : '') + fmt.number(v) },
      { key: 'cupons', label: '🧾 Cupons Emitidos (Notas)', fmt: fmt.number, diffFmt: (v) => (v > 0 ? '+' : '') + fmt.number(v) },
      { key: 'quantidade', label: '📦 Quantidade de Produtos (Peças)', fmt: fmt.number, diffFmt: (v) => (v > 0 ? '+' : '') + fmt.number(v) },
      { key: 'ticketMedio', label: '🏷️ Ticket Médio (TKM)', fmt: fmt.currency, diffFmt: fmt.currency },
      { key: 'ticketPorCliente', label: '💼 Gasto Médio por Cliente', fmt: fmt.currency, diffFmt: fmt.currency },
      { key: 'itensPorNota', label: '🛒 Itens por Nota (IPN)', fmt: (v) => fmt.decimal(v, 1) + ' pçs', diffFmt: (v) => fmt.decimal(v, 1) + ' pçs' },
      { key: 'itensPorCliente', label: '🛍️ Itens por Cliente (IPC)', fmt: (v) => fmt.decimal(v, 1) + ' pçs', diffFmt: (v) => fmt.decimal(v, 1) + ' pçs' },
      { key: 'cuponsPorCliente', label: '🔄 Frequência de Compra', fmt: (v) => fmt.decimal(v, 2) + ' cupons', diffFmt: (v) => fmt.decimal(v, 2) + ' cupons' },
    ];

    const tbody = document.getElementById('momTableBody');
    tbody.innerHTML = momRows.map(row => {
      const item = g[row.key] || { atual: 0, anterior: 0, variacao: null };
      const diff = (item.atual || 0) - (item.anterior || 0);
      const varPct = item.variacao;
      const isPos = varPct > 0;
      const isNeg = varPct < 0;
      const badgeCls = isPos ? 'positive' : isNeg ? 'negative' : 'neutral';
      const arrow = isPos ? '↑' : isNeg ? '↓' : '→';

      return `
        <tr>
          <td class="bold">${row.label}</td>
          <td class="right bold">${row.fmt(item.atual)}</td>
          <td class="right" style="color:var(--text-muted);">${row.fmt(item.anterior)}</td>
          <td class="right">${row.diffFmt(diff)}</td>
          <td class="right">
            <span class="mom-badge ${badgeCls}">
              ${arrow} ${varPct != null ? (isPos ? '+' : '') + fmt.decimal(varPct, 1) + '%' : 'N/A'}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  },

  // ============================================================
  // Gráfico Desempenho (Real vs Metas - Dia ou Semana)
  // ============================================================
  renderDailyChart(d) {
    destroyChart('chartDaily');
    const ctx = document.getElementById('chartDaily').getContext('2d');
    const isSemana = this.viewMode === 'semana';
    const trendFiltered = isSemana ? (d.weekly || []) : d.daily.filter(x => x.dia <= Math.min(d.diaCorte + 2, d.diasNoMes));
    const labels = trendFiltered.map(x => x.labelCompleto || (isSemana ? x.semanaKey : `Dia ${x.dia}`));

    charts.chartDaily = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: isSemana ? 'Resultado Líquido Real (Semana)' : 'Resultado Líquido Real (Dia)',
            data: trendFiltered.map(x => (isSemana || x.dia <= d.diaCorte) ? x.resultadoLiquido : null),
            backgroundColor: trendFiltered.map(x => (isSemana || x.dia <= d.diaCorte) && x.temDados ? 'rgba(99,102,241,0.75)' : 'rgba(99,102,241,0.1)'),
            borderColor: trendFiltered.map(x => (isSemana || x.dia <= d.diaCorte) && x.temDados ? 'rgba(99,102,241,0.95)' : 'rgba(99,102,241,0.2)'),
            borderWidth: 1,
            order: 2,
          },
          {
            label: isSemana ? 'Meta Orçada Semanal' : 'Meta Orçada Diária',
            data: trendFiltered.map(x => x.metaOrcada),
            type: 'line',
            borderColor: COLORS.green,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 3],
            pointRadius: 2,
            pointBackgroundColor: COLORS.green,
            order: 1,
          },
          {
            label: isSemana ? 'Meta Desafio Semanal' : 'Meta Desafio Diária',
            data: trendFiltered.map(x => x.metaDesafio),
            type: 'line',
            borderColor: COLORS.orange,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [2, 2],
            pointRadius: 2,
            pointBackgroundColor: COLORS.orange,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20, bottom: 10, left: 10, right: 10 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          datalabels: { display: false },
          tooltip: {
            callbacks: {
              title: (c) => `${isSemana ? '📅 Semana' : '📅 Data'}: ${c[0].label}`,
              label: (c) => ` ${c.dataset.label}: ${fmt.currency(c.raw)}`,
            },
          },
        },
        scales: {
          x: SCALE_CONFIG_X,
          y: { ...SCALE_CONFIG_Y, ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => fmt.currencyK(v) } },
        },
      },
    });
  },

  // ============================================================
  // Gráfico Acumulado
  // ============================================================
  renderAcumuladoChart(d) {
    destroyChart('chartAcumulado');
    const ctx = document.getElementById('chartAcumulado').getContext('2d');
    const isSemana = this.viewMode === 'semana';
    const trendFiltered = isSemana ? (d.weekly || []) : d.daily.filter(x => x.dia <= Math.min(d.diaCorte + 2, d.diasNoMes));
    const labels = trendFiltered.map(x => x.labelCompleto || (isSemana ? x.semanaKey : `Dia ${x.dia}`));

    charts.chartAcumulado = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Realizado Acumulado',
            data: trendFiltered.map(x => (isSemana || x.dia <= d.diaCorte) ? x.acumReal : null),
            borderColor: COLORS.blue,
            backgroundColor: COLORS.gradient(ctx, 'rgba(99,102,241,0.25)', 'rgba(99,102,241,0.01)'),
            borderWidth: 3,
            fill: true,
            pointRadius: trendFiltered.map(x => (!isSemana && x.dia === d.diaCorte) ? 5 : 2),
            pointBackgroundColor: COLORS.blue,
          },
          {
            label: 'Meta Orçada Acumulada',
            data: trendFiltered.map(x => x.acumOrcada),
            borderColor: COLORS.green,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 3],
            fill: false,
            pointRadius: 0,
          },
          {
            label: 'Meta Desafio Acumulada',
            data: trendFiltered.map(x => x.acumDesafio),
            borderColor: COLORS.orange,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [3, 3],
            fill: false,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20, bottom: 10, left: 10, right: 10 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          datalabels: { display: false },
          tooltip: {
            callbacks: {
              title: (c) => `${isSemana ? '📅 Semana' : '📅 Data'}: ${c[0].label}`,
              label: (c) => ` ${c.dataset.label}: ${fmt.currency(c.raw)}`,
            },
          },
        },
        scales: {
          x: SCALE_CONFIG_X,
          y: { ...SCALE_CONFIG_Y, ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => fmt.currencyK(v) } },
        },
      },
    });
  },

  // ============================================================
  // Canais
  // ============================================================
  renderChannels(d) {
    const channels = d.channels || [];
    const sortedChannels = [...channels].sort((a, b) => (b.resultadoLiquido || 0) - (a.resultadoLiquido || 0));

    destroyChart('chartChannelBar');
    const canvas = document.getElementById('chartChannelBar');
    if (canvas) {
      const ctx = canvas.getContext('2d');

      charts.chartChannelBar = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: sortedChannels.map(c => String(c.canal || 'N/A')),
          datasets: [
            {
              label: '% Share Mês Atual',
              data: sortedChannels.map(c => c.pctTotal || 0),
              backgroundColor: 'rgba(99, 102, 241, 0.85)',
              borderColor: '#6366f1',
              borderWidth: 1.5,
              borderRadius: 6,
            },
            {
              label: '% Share Mês Anterior (Mesmo Período)',
              data: sortedChannels.map(c => c.pctTotalAnterior || 0),
              backgroundColor: 'rgba(148, 163, 184, 0.35)',
              borderColor: 'rgba(148, 163, 184, 0.6)',
              borderWidth: 1.5,
              borderRadius: 6,
            }
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 36, bottom: 10, left: 10, right: 10 } },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: { color: '#94a3b8', font: { size: 11, weight: '600' }, boxWidth: 12, usePointStyle: true },
            },
            datalabels: {
              anchor: 'end',
              align: 'top',
              offset: 2,
              font: { size: 10, weight: '700', family: "'JetBrains Mono'" },
              formatter: (v, ctx) => {
                if (ctx.datasetIndex === 0) {
                  const item = sortedChannels[ctx.dataIndex];
                  const diffPP = item ? item.diferencaPctPP : 0;
                  const arrow = diffPP > 0 ? '↑' : diffPP < 0 ? '↓' : '→';
                  const sign = diffPP > 0 ? '+' : '';
                  return [`${v.toFixed(1)}%`, `${arrow}${sign}${diffPP.toFixed(1)} p.p.`];
                } else {
                  return `${v.toFixed(1)}%`;
                }
              },
              color: (ctx) => {
                if (ctx.datasetIndex === 0) {
                  const item = sortedChannels[ctx.dataIndex];
                  const diffPP = item ? item.diferencaPctPP : 0;
                  return diffPP >= 0 ? '#34d399' : '#f87171';
                }
                return '#94a3b8';
              },
            },
            tooltip: {
              callbacks: {
                label: (c) => {
                  const item = sortedChannels[c.dataIndex];
                  const valPct = c.raw || 0;
                  if (c.datasetIndex === 0) {
                    const rl = item ? item.resultadoLiquido : 0;
                    const diffPP = item ? item.diferencaPctPP : 0;
                    const sign = diffPP > 0 ? '+' : '';
                    return ` Mês Atual: ${valPct.toFixed(1)}% (${fmt.currency(rl)}) | Var Share: ${sign}${diffPP.toFixed(1)} p.p.`;
                  } else {
                    const rlPrev = item ? item.resultadoLiquidoAnterior : 0;
                    return ` Mês Anterior: ${valPct.toFixed(1)}% (${fmt.currency(rlPrev)})`;
                  }
                },
              },
            },
          },
          scales: {
            x: { ...SCALE_CONFIG_X, ticks: { ...SCALE_CONFIG_X.ticks, font: { size: 10 } } },
            y: {
              ...SCALE_CONFIG_Y,
              ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => `${v}%` },
              title: { display: true, text: '% Participação no Faturamento Total', color: '#94a3b8', font: { size: 10 } },
            },
          },
        },
      });
    }

    const subtitleEl = document.getElementById('channelTableSubtitle');
    if (subtitleEl) {
      subtitleEl.textContent = `Métricas consolidadas de faturamento, cupons, clientes, ticket médio e evolução de share em p.p. comparadas com o mesmo período do mês anterior`;
    }

    const tbody = document.getElementById('tableChannelsBody');
    tbody.innerHTML = channels.map(c => {
      const rlAtual = c.resultadoLiquido || 0;
      const rlPrev = c.resultadoLiquidoAnterior || 0;
      const varRL = c.variacaoRL;

      const isPos = varRL > 0;
      const isNeg = varRL < 0;
      const badgeCls = isPos ? 'mom-badge-pos' : isNeg ? 'mom-badge-neg' : 'mom-badge-neu';
      const arrow = isPos ? '↑' : isNeg ? '↓' : '→';
      const varText = varRL != null ? `${arrow} ${isPos ? '+' : ''}${varRL.toFixed(1)}%` : 'N/A';

      const cuponsAtual = c.cupons || 0;
      const cuponsPrev = c.cuponsAnterior || 0;

      const cliAtual = c.clientes || 0;
      const cliPrev = c.clientesAnterior || 0;

      const tkmAtual = c.ticketMedio || (cuponsAtual > 0 ? rlAtual / cuponsAtual : 0);
      const tkmPrev = c.ticketMedioAnterior || (cuponsPrev > 0 ? rlPrev / cuponsPrev : 0);

      const pctAtual = c.pctTotal || 0;
      const pctPrev = c.pctTotalAnterior || 0;
      const diffPP = c.diferencaPctPP || 0;
      const isPosPP = diffPP > 0;
      const isNegPP = diffPP < 0;
      const badgeClsPP = isPosPP ? 'mom-badge-pos' : isNegPP ? 'mom-badge-neg' : 'mom-badge-neu';
      const arrowPP = isPosPP ? '↑' : isNegPP ? '↓' : '→';
      const ppText = `${arrowPP} ${isPosPP ? '+' : ''}${diffPP.toFixed(1)} p.p.`;

      return `
        <tr>
          <td class="bold sticky-col">${c.canal || 'N/A'}</td>
          <td class="right bold text-accent">${fmt.currency(rlAtual)}</td>
          <td class="right text-muted">${fmt.currency(rlPrev)}</td>
          <td class="center"><span class="mom-badge ${badgeCls}">${varText}</span></td>
          <td class="right bold">${fmt.number(cuponsAtual)}</td>
          <td class="right text-muted">${fmt.number(cuponsPrev)}</td>
          <td class="right bold">${fmt.number(cliAtual)}</td>
          <td class="right text-muted">${fmt.number(cliPrev)}</td>
          <td class="right bold">${fmt.currency(tkmAtual)}</td>
          <td class="right text-muted">${fmt.currency(tkmPrev)}</td>
          <td class="right bold">${fmt.pct(pctAtual)}</td>
          <td class="right text-muted">${fmt.pct(pctPrev)}</td>
          <td class="center"><span class="mom-badge ${badgeClsPP}">${ppText}</span></td>
        </tr>
      `;
    }).join('');
  },

  // ============================================================
  // Dia da Semana (Com ordenação segura e escala visível)
  // ============================================================
  renderWeekdayCharts(d) {
    const weekdays = Array.from(d.weekdays || []);
    const order = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'sab', 'dom'];

    weekdays.sort((a, b) => {
      const nameA = String(a.diaSemana || a['Dia da Semana'] || '').toLowerCase();
      const nameB = String(b.diaSemana || b['Dia da Semana'] || '').toLowerCase();
      const ia = order.findIndex(o => nameA.startsWith(o.substring(0, 3)));
      const ib = order.findIndex(o => nameB.startsWith(o.substring(0, 3)));
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const labels = weekdays.map(w => String(w.diaSemana || w['Dia da Semana'] || 'N/A'));

    // 1. Faturamento por Dia da Semana
    destroyChart('chartWeekdayRL');
    const ctx1 = document.getElementById('chartWeekdayRL').getContext('2d');
    charts.chartWeekdayRL = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Resultado Líquido Acumulado',
          data: weekdays.map(w => w.resultadoLiquido || 0),
          backgroundColor: 'rgba(99,102,241,0.65)',
          borderColor: 'rgba(99,102,241,0.9)',
          borderWidth: 1.5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20, bottom: 10, left: 10, right: 10 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: 'end', align: 'top', offset: 2,
            color: '#818cf8',
            font: { size: 10, weight: '700', family: "'JetBrains Mono'" },
            formatter: (v) => fmt.currencyK(v),
          },
        },
        scales: {
          x: SCALE_CONFIG_X,
          y: { ...SCALE_CONFIG_Y, ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => fmt.currencyK(v) } },
        },
      },
    });

    // 2. Volume Operacional por Dia da Semana
    destroyChart('chartWeekdayOps');
    const ctx2 = document.getElementById('chartWeekdayOps').getContext('2d');
    charts.chartWeekdayOps = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Cupons Emitidos', data: weekdays.map(w => w.cupons || 0), backgroundColor: 'rgba(139,92,246,0.6)', borderColor: 'rgba(139,92,246,0.9)', borderWidth: 1.5 },
          { label: 'Clientes Únicos', data: weekdays.map(w => w.clientes || 0), backgroundColor: 'rgba(34,211,238,0.6)', borderColor: 'rgba(34,211,238,0.9)', borderWidth: 1.5 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20, bottom: 10, left: 10, right: 10 } },
        plugins: {
          datalabels: { display: false },
        },
        scales: {
          x: SCALE_CONFIG_X,
          y: { ...SCALE_CONFIG_Y, ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => fmt.number(v) } },
        },
      },
    });
  },

  // ============================================================
  // Categorias (Grupos - Com tratamento seguro de labels)
  // ============================================================
  renderCategories(d) {
    const groups = d.groups || [];

    destroyChart('chartGroupsBar');
    const canvas = document.getElementById('chartGroupsBar');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const labels = groups.map(g => {
        const name = String(g.label || 'N/A');
        return name.length > 22 ? name.substring(0, 20) + '…' : name;
      });

      charts.chartGroupsBar = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Resultado Líquido',
            data: groups.map(g => g.resultadoLiquido || 0),
            backgroundColor: groups.map((_, i) => `hsla(${235 + i * 12}, 70%, 65%, 0.65)`),
            borderColor: groups.map((_, i) => `hsla(${235 + i * 12}, 70%, 65%, 0.9)`),
            borderWidth: 1.5,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 10, bottom: 10, left: 10, right: 30 } },
          plugins: {
            legend: { display: false },
            datalabels: {
              anchor: 'end', align: 'end', offset: 4,
              color: '#818cf8',
              font: { size: 9, weight: '700', family: "'JetBrains Mono'" },
              formatter: (v) => fmt.currencyK(v),
            },
          },
          scales: {
            x: { ...SCALE_CONFIG_Y, ticks: { ...SCALE_CONFIG_Y.ticks, callback: (v) => fmt.currencyK(v) } },
            y: { ...SCALE_CONFIG_X, ticks: { ...SCALE_CONFIG_X.ticks, font: { size: 10 } } },
          },
        },
      });
    }

    function renderMoMCategoryRows(items) {
      return items.map(item => {
        const rankCls = item.rank === 1 ? 'gold' : item.rank === 2 ? 'silver' : item.rank === 3 ? 'bronze' : 'normal';
        const rlAtual = item.resultadoLiquido || 0;
        const rlPrev = item.resultadoLiquidoAnterior || 0;
        const varRL = item.variacaoRL;

        const isPos = varRL > 0;
        const isNeg = varRL < 0;
        const badgeCls = isPos ? 'mom-badge-pos' : isNeg ? 'mom-badge-neg' : 'mom-badge-neu';
        const arrow = isPos ? '↑' : isNeg ? '↓' : '→';
        const varText = varRL != null ? `${arrow} ${isPos ? '+' : ''}${varRL.toFixed(1)}%` : 'N/A';

        const qtdAtual = item.quantidade || 0;
        const qtdPrev = item.quantidadeAnterior || 0;

        return `
          <tr>
            <td><span class="rank-badge ${rankCls}">${item.rank}</span></td>
            <td class="bold sticky-col">${item.label || 'N/A'}</td>
            <td class="right bold text-accent">${fmt.currency(rlAtual)}</td>
            <td class="right text-muted">${fmt.currency(rlPrev)}</td>
            <td class="center"><span class="mom-badge ${badgeCls}">${varText}</span></td>
            <td class="right bold">${fmt.number(qtdAtual)}</td>
            <td class="right text-muted">${fmt.number(qtdPrev)}</td>
            <td class="right">
              <div class="pct-bar">
                <div class="pct-bar-track"><div class="pct-bar-fill" style="width:${item.pctTotal}%"></div></div>
                <span class="pct-bar-label">${fmt.pct(item.pctTotal)}</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    const tbody = document.getElementById('tableGroupsBody');
    tbody.innerHTML = this.renderFullMoMCategoryRows(groups);
  },

  updateCategoryFilterDropdowns(d) {
    const opts = d.opcoesFiltros;
    if (!opts) return;

    const selectGrupo = document.getElementById('filterGrupo');
    const selectLinha = document.getElementById('filterLinha');
    const selectSubgrupo = document.getElementById('filterSubgrupo');

    if (selectGrupo && selectGrupo.options.length <= 1 && opts.grupos && opts.grupos.length > 0) {
      selectGrupo.innerHTML = '<option value="TODOS">📦 Todos os Grupos</option>' +
        opts.grupos.map(g => `<option value="${g}">${g}</option>`).join('');
    }
    if (selectLinha && selectLinha.options.length <= 1 && opts.linhas && opts.linhas.length > 0) {
      selectLinha.innerHTML = '<option value="TODOS">🏷️ Todas as Linhas</option>' +
        opts.linhas.map(l => `<option value="${l}">${l}</option>`).join('');
    }
    if (selectSubgrupo && selectSubgrupo.options.length <= 1 && opts.subgrupos && opts.subgrupos.length > 0) {
      selectSubgrupo.innerHTML = '<option value="TODOS">📁 Todos os Subgrupos</option>' +
        opts.subgrupos.map(sg => `<option value="${sg}">${sg}</option>`).join('');
    }

    if (selectGrupo) selectGrupo.value = this.selectedGrupo;
    if (selectLinha) selectLinha.value = this.selectedLinha;
    if (selectSubgrupo) selectSubgrupo.value = this.selectedSubgrupo;
  },

  renderFullMoMCategoryRows(items) {
    return items.map(item => {
      const rankCls = item.rank === 1 ? 'gold' : item.rank === 2 ? 'silver' : item.rank === 3 ? 'bronze' : 'normal';
      const rlAtual = item.resultadoLiquido || 0;
      const rlPrev = item.resultadoLiquidoAnterior || 0;
      const varRL = item.variacaoRL;

      const isPos = varRL > 0;
      const isNeg = varRL < 0;
      const badgeCls = isPos ? 'mom-badge-pos' : isNeg ? 'mom-badge-neg' : 'mom-badge-neu';
      const arrow = isPos ? '↑' : isNeg ? '↓' : '→';
      const varText = varRL != null ? `${arrow} ${isPos ? '+' : ''}${varRL.toFixed(1)}%` : 'N/A';

      const cuponsAtual = item.cupons || 0;
      const cuponsPrev = item.cuponsAnterior || 0;

      const cliAtual = item.clientes || 0;
      const cliPrev = item.clientesAnterior || 0;

      const tkmAtual = item.ticketMedio || (cuponsAtual > 0 ? rlAtual / cuponsAtual : 0);
      const tkmPrev = item.ticketMedioAnterior || (cuponsPrev > 0 ? rlPrev / cuponsPrev : 0);

      const qtdAtual = item.quantidade || 0;
      const qtdPrev = item.quantidadeAnterior || 0;

      return `
        <tr>
          <td><span class="rank-badge ${rankCls}">${item.rank}</span></td>
          <td class="bold sticky-col">${item.label || 'N/A'}</td>
          <td class="right bold text-accent">${fmt.currency(rlAtual)}</td>
          <td class="right text-muted">${fmt.currency(rlPrev)}</td>
          <td class="center"><span class="mom-badge ${badgeCls}">${varText}</span></td>
          <td class="right bold">${fmt.number(cuponsAtual)}</td>
          <td class="right text-muted">${fmt.number(cuponsPrev)}</td>
          <td class="right bold">${fmt.number(cliAtual)}</td>
          <td class="right text-muted">${fmt.number(cliPrev)}</td>
          <td class="right bold">${fmt.currency(tkmAtual)}</td>
          <td class="right text-muted">${fmt.currency(tkmPrev)}</td>
          <td class="right bold">${fmt.number(qtdAtual)}</td>
          <td class="right text-muted">${fmt.number(qtdPrev)}</td>
          <td class="right">
            <div class="pct-bar">
              <div class="pct-bar-track"><div class="pct-bar-fill" style="width:${item.pctTotal}%"></div></div>
              <span class="pct-bar-label">${fmt.pct(item.pctTotal)}</span>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  // ============================================================
  // Linhas
  // ============================================================
  renderLines(d) {
    const lines = d.lines || [];
    const tbody = document.getElementById('tableLinesBody');
    tbody.innerHTML = this.renderFullMoMCategoryRows(lines);
  },

  // ============================================================
  // Subgrupos
  // ============================================================
  renderSubgroups(d) {
    const subs = d.subgroups || [];
    const tbody = document.getElementById('tableSubgroupsBody');
    tbody.innerHTML = this.renderFullMoMCategoryRows(subs);
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
