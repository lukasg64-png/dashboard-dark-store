/**
 * Data Service — Combina dados do Qlik (realizado) com Excel (metas)
 * Calcula todos os KPIs, crescimento, rankings e aberturas
 */
const excelReader = require('./excelReader');

// Cache de dados para evitar múltiplas requisições ao Qlik
let dataCache = {
  currentMonth: null,
  previousMonth: null,
  timestamp: null,
  mesAno: null,
};

const CACHE_DURATION = (parseInt(process.env.REFRESH_INTERVAL) || 15) * 60 * 1000;

/**
 * Retorna o mês no formato YYYY-MM
 */
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPreviousMonth(mesAno) {
  const [year, month] = mesAno.split('-').map(Number);
  const prev = new Date(year, month - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function getDiaAtual() {
  return new Date().getDate();
}

/**
 * Formata mês-ano Qlik (pode vir como "2026-07", "Jul 2026", "07/2026")
 * para o formato padronizado "YYYY-MM"
 */
function normalizeMesAno(mesAno) {
  if (!mesAno) return getCurrentMonth();
  // Se já está no formato YYYY-MM
  if (/^\d{4}-\d{2}$/.test(mesAno)) return mesAno;
  return mesAno;
}

/**
 * Calcula KPIs principais a partir dos dados diários
 */
function calcularKPIs(dailyData) {
  const totals = dailyData.reduce((acc, d) => {
    acc.resultadoLiquido += d.resultadoLiquido || 0;
    acc.quantidade += d.quantidade || 0;
    acc.cupons += d.cupons || 0;
    acc.clientes += d.clientes || 0;
    return acc;
  }, { resultadoLiquido: 0, quantidade: 0, cupons: 0, clientes: 0 });

  const ticketMedio = totals.cupons > 0 ? totals.resultadoLiquido / totals.cupons : 0;
  const itensPorNota = totals.cupons > 0 ? totals.quantidade / totals.cupons : 0;
  const itensPorCliente = totals.clientes > 0 ? totals.quantidade / totals.clientes : 0;
  const cuponsPorCliente = totals.clientes > 0 ? totals.cupons / totals.clientes : 0;
  const ticketPorCliente = totals.clientes > 0 ? totals.resultadoLiquido / totals.clientes : 0;

  return {
    ...totals,
    ticketMedio,
    itensPorNota,
    itensPorCliente,
    cuponsPorCliente,
    ticketPorCliente,
    diasComDados: dailyData.length,
    mediaDiaria: dailyData.length > 0 ? totals.resultadoLiquido / dailyData.length : 0,
  };
}

/**
 * Calcula crescimento mês atual vs mês anterior (mesmo período)
 */
function calcularCrescimento(kpisAtual, kpisAnterior) {
  function pctChange(atual, anterior) {
    if (!anterior || anterior === 0) return null;
    return ((atual - anterior) / Math.abs(anterior)) * 100;
  }

  return {
    resultadoLiquido: {
      atual: kpisAtual.resultadoLiquido,
      anterior: kpisAnterior.resultadoLiquido,
      variacao: pctChange(kpisAtual.resultadoLiquido, kpisAnterior.resultadoLiquido),
    },
    cupons: {
      atual: kpisAtual.cupons,
      anterior: kpisAnterior.cupons,
      variacao: pctChange(kpisAtual.cupons, kpisAnterior.cupons),
    },
    clientes: {
      atual: kpisAtual.clientes,
      anterior: kpisAnterior.clientes,
      variacao: pctChange(kpisAtual.clientes, kpisAnterior.clientes),
    },
    ticketMedio: {
      atual: kpisAtual.ticketMedio,
      anterior: kpisAnterior.ticketMedio,
      variacao: pctChange(kpisAtual.ticketMedio, kpisAnterior.ticketMedio),
    },
    ticketPorCliente: {
      atual: kpisAtual.ticketPorCliente,
      anterior: kpisAnterior.ticketPorCliente,
      variacao: pctChange(kpisAtual.ticketPorCliente, kpisAnterior.ticketPorCliente),
    },
    itensPorNota: {
      atual: kpisAtual.itensPorNota,
      anterior: kpisAnterior.itensPorNota,
      variacao: pctChange(kpisAtual.itensPorNota, kpisAnterior.itensPorNota),
    },
    itensPorCliente: {
      atual: kpisAtual.itensPorCliente,
      anterior: kpisAnterior.itensPorCliente,
      variacao: pctChange(kpisAtual.itensPorCliente, kpisAnterior.itensPorCliente),
    },
    cuponsPorCliente: {
      atual: kpisAtual.cuponsPorCliente,
      anterior: kpisAnterior.cuponsPorCliente,
      variacao: pctChange(kpisAtual.cuponsPorCliente, kpisAnterior.cuponsPorCliente),
    },
    quantidade: {
      atual: kpisAtual.quantidade,
      anterior: kpisAnterior.quantidade,
      variacao: pctChange(kpisAtual.quantidade, kpisAnterior.quantidade),
    },
  };
}

/**
 * Combina dados diários do Qlik com metas do Excel
 */
function combinarDailyComMetas(dailyData, metas, mesAno) {
  // Parsing de ano e mês para formatação de datas reais
  const parts = (mesAno || getCurrentMonth()).split('-');
  const year = parseInt(parts[0]) || new Date().getFullYear();
  const month = parseInt(parts[1]) || (new Date().getMonth() + 1);
  const weekdaysMap = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  // Mapa de metas por dia
  const metaMap = {};
  for (const m of metas) {
    metaMap[m.dia] = m;
  }

  // Mapa de realizado por dia
  const realMap = {};
  for (const d of dailyData) {
    const dia = parseInt(d.Dia || d['Dia_num'] || 0);
    if (dia > 0) {
      realMap[dia] = d;
    }
  }

  // Combina: todos os dias do mês (1 até o último dia com meta ou dado)
  const maxDia = Math.max(
    ...Object.keys(metaMap).map(Number),
    ...Object.keys(realMap).map(Number),
    1
  );

  let acumReal = 0, acumOrcada = 0, acumDesafio = 0;
  const combined = [];

  for (let dia = 1; dia <= maxDia; dia++) {
    const real = realMap[dia] || {};
    const meta = metaMap[dia] || {};

    const resultadoLiquido = real.resultadoLiquido || 0;
    const metaOrcada = meta.metaOrcada || 0;
    const metaDesafio = meta.metaDesafio || 0;

    acumReal += resultadoLiquido;
    acumOrcada += metaOrcada;
    acumDesafio += metaDesafio;

    // Formatação de data real
    const dateObj = new Date(year, month - 1, dia);
    const dayStr = String(dia).padStart(2, '0');
    const monthStr = String(month).padStart(2, '0');
    const diaSemana = weekdaysMap[dateObj.getDay()];
    const dataFmt = `${dayStr}/${monthStr}`;
    const labelCompleto = `${dataFmt} (${diaSemana})`;

    const cupons = real.cupons || 0;
    const clientes = real.clientes || 0;
    const quantidade = real.quantidade || 0;

    combined.push({
      dia,
      dataFmt,
      diaSemana,
      labelCompleto,
      resultadoLiquido,
      quantidade,
      cupons,
      clientes,
      ticketMedio: cupons > 0 ? resultadoLiquido / cupons : 0,
      itensPorNota: cupons > 0 ? quantidade / cupons : 0,
      itensPorCliente: clientes > 0 ? quantidade / clientes : 0,
      cuponsPorCliente: clientes > 0 ? cupons / clientes : 0,
      ticketPorCliente: clientes > 0 ? resultadoLiquido / clientes : 0,
      metaOrcada,
      metaDesafio,
      acumReal,
      acumOrcada,
      acumDesafio,
      pctOrcada: acumOrcada > 0 ? (acumReal / acumOrcada) * 100 : null,
      pctDesafio: acumDesafio > 0 ? (acumReal / acumDesafio) * 100 : null,
      temDados: resultadoLiquido > 0,
    });
  }

  return combined;
}

/**
 * Calcula projeção de fechamento do mês
 */
function calcularProjecao(kpis, diasTotaisMes) {
  if (kpis.diasComDados === 0) return 0;
  return (kpis.resultadoLiquido / kpis.diasComDados) * diasTotaisMes;
}

/**
 * Rankeia dados por resultado líquido
 */
function rankear(data, labelField, topN = 10) {
  return data
    .sort((a, b) => (b.resultadoLiquido || 0) - (a.resultadoLiquido || 0))
    .slice(0, topN)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      label: item[labelField] || 'N/A',
      resultadoLiquido: item.resultadoLiquido || 0,
      quantidade: item.quantidade || 0,
      cupons: item.cupons || 0,
      clientes: item.clientes || 0,
      pctTotal: 0,
    }));
}

/**
 * Monta resposta completa do dashboard
 */
function buildDashboardResponse(currentData, previousData, mesAno, diaAteParam = null) {
  const isCurrentMonth = mesAno === getCurrentMonth();
  const diaHoje = getDiaAtual();
  const diasNoMes = new Date(parseInt(mesAno.split('-')[0]), parseInt(mesAno.split('-')[1]), 0).getDate();

  // Definição do dia de corte (default = D-1 se mês atual, senão dia 31/fim do mês)
  let diaCorte;
  if (diaAteParam != null && !isNaN(diaAteParam)) {
    diaCorte = Math.min(Math.max(1, diaAteParam), diasNoMes);
  } else if (isCurrentMonth) {
    // PADRÃO SOLICITADO: D-1 (Ontem)
    diaCorte = Math.max(1, diaHoje - 1);
  } else {
    diaCorte = diasNoMes;
  }

  const mesAnterior = getPreviousMonth(mesAno);

  // Metas do Excel acumuladas até o diaCorte
  const metasAtual = excelReader.getMetasByMonth(mesAno);
  const metasAcum = excelReader.getMetasAcumuladas(mesAno, diaCorte);

  // KPIs mês atual (filtrados até diaCorte)
  const dailyAtual = currentData?.daily || [];
  const dailyAtualAteDia = dailyAtual.filter(d => parseInt(d.Dia || d.dia || 0) <= diaCorte);
  const kpisAtual = calcularKPIs(dailyAtualAteDia);

  // KPIs mês anterior (mesmo período - até o mesmo diaCorte)
  const dailyAnterior = previousData?.daily || [];
  const dailyAnteriorAteDia = dailyAnterior.filter(d => parseInt(d.Dia || d.dia || 0) <= diaCorte);
  const kpisAnterior = calcularKPIs(dailyAnteriorAteDia);

  // Crescimento MoM
  const crescimento = calcularCrescimento(kpisAtual, kpisAnterior);

  // Combinar daily com metas (com formatação de data real)
  const dailyCombined = combinarDailyComMetas(dailyAtual, metasAtual, mesAno);

  // Projeção de fechamento do mês
  const projecao = calcularProjecao(kpisAtual, diasNoMes);

  // Atingimento de metas
  const pctOrcada = metasAcum.totalOrcada > 0 ? (kpisAtual.resultadoLiquido / metasAcum.totalOrcada) * 100 : null;
  const pctDesafio = metasAcum.totalDesafio > 0 ? (kpisAtual.resultadoLiquido / metasAcum.totalDesafio) * 100 : null;

  // Mapas do Mês Anterior (mesmo período decorrido D1..DiaCorte)
  const prevChannelsMap = new Map((previousData?.channels || []).map(c => [c.Canal, c]));
  const prevGroupsMap = new Map((previousData?.groups || []).map(g => [g.Desc_Grupo, g]));
  const prevLinesMap = new Map((previousData?.lines || []).map(l => [l.Desc_Linha, l]));
  const prevSubgroupsMap = new Map((previousData?.subgroups || []).map(sg => [sg.Desc_Subgrupo, sg]));

  // Canais com comparativo MoM completo
  const channels = (currentData?.channels || []).map(ch => {
    const prev = prevChannelsMap.get(ch.Canal) || {};
    const rlAtual = ch.resultadoLiquido || 0;
    const rlPrev = prev.resultadoLiquido || 0;
    const cuponsAtual = ch.cupons || 0;
    const cuponsPrev = prev.cupons || 0;
    const clientesAtual = ch.clientes || 0;
    const clientesPrev = prev.clientes || 0;

    const tkmAtual = cuponsAtual > 0 ? rlAtual / cuponsAtual : 0;
    const tkmPrev = cuponsPrev > 0 ? rlPrev / cuponsPrev : 0;

    const varRL = rlPrev > 0 ? ((rlAtual - rlPrev) / rlPrev) * 100 : (rlAtual > 0 ? 100 : 0);
    const varCupons = cuponsPrev > 0 ? ((cuponsAtual - cuponsPrev) / cuponsPrev) * 100 : (cuponsAtual > 0 ? 100 : 0);

    return {
      canal: ch.Canal || 'N/A',
      resultadoLiquido: rlAtual,
      resultadoLiquidoAnterior: rlPrev,
      variacaoRL: varRL,
      cupons: cuponsAtual,
      cuponsAnterior: cuponsPrev,
      variacaoCupons: varCupons,
      clientes: clientesAtual,
      clientesAnterior: clientesPrev,
      ticketMedio: tkmAtual,
      ticketMedioAnterior: tkmPrev,
      quantidade: ch.quantidade || 0,
    };
  });
  const totalRL = channels.reduce((s, c) => s + c.resultadoLiquido, 0);
  const totalRLAnterior = channels.reduce((s, c) => s + c.resultadoLiquidoAnterior, 0);

  channels.forEach(c => {
    c.pctTotal = totalRL > 0 ? (c.resultadoLiquido / totalRL) * 100 : 0;
    c.pctTotalAnterior = totalRLAnterior > 0 ? (c.resultadoLiquidoAnterior / totalRLAnterior) * 100 : 0;
    c.diferencaPctPP = c.pctTotal - c.pctTotalAnterior;
  });
  channels.sort((a, b) => b.resultadoLiquido - a.resultadoLiquido);

  // Helper para injetar comparativo em agrupamentos de produtos
  function enriquecerComMoM(items, keyField, prevMap) {
    return items.map(item => {
      const name = item[keyField] || 'N/A';
      const prev = prevMap.get(name) || {};
      const rlAtual = item.resultadoLiquido || 0;
      const rlPrev = prev.resultadoLiquido || 0;
      const qtdAtual = item.quantidade || 0;
      const qtdPrev = prev.quantidade || 0;
      const cuponsAtual = item.cupons || 0;
      const cuponsPrev = prev.cupons || 0;
      const cliAtual = item.clientes || 0;
      const cliPrev = prev.clientes || 0;

      const tkmAtual = cuponsAtual > 0 ? rlAtual / cuponsAtual : 0;
      const tkmPrev = cuponsPrev > 0 ? rlPrev / cuponsPrev : 0;

      const varRL = rlPrev > 0 ? ((rlAtual - rlPrev) / rlPrev) * 100 : (rlAtual > 0 ? 100 : 0);
      const varQtd = qtdPrev > 0 ? ((qtdAtual - qtdPrev) / qtdPrev) * 100 : (qtdAtual > 0 ? 100 : 0);

      return {
        ...item,
        resultadoLiquido: rlAtual,
        resultadoLiquidoAnterior: rlPrev,
        variacaoRL: varRL,
        cupons: cuponsAtual,
        cuponsAnterior: cuponsPrev,
        clientes: cliAtual,
        clientesAnterior: cliPrev,
        ticketMedio: tkmAtual,
        ticketMedioAnterior: tkmPrev,
        quantidade: qtdAtual,
        quantidadeAnterior: qtdPrev,
        variacaoQtd: varQtd,
      };
    });
  }

  // Categorias
  const groupsRaw = enriquecerComMoM(currentData?.groups || [], 'Desc_Grupo', prevGroupsMap);
  const groups = rankear(groupsRaw, 'Desc_Grupo', 15);
  const totalGrupos = groupsRaw.reduce((s, g) => s + (g.resultadoLiquido || 0), 0);
  groups.forEach(g => { g.pctTotal = totalGrupos > 0 ? (g.resultadoLiquido / totalGrupos) * 100 : 0; });

  const linesRaw = enriquecerComMoM(currentData?.lines || [], 'Desc_Linha', prevLinesMap);
  const lines = rankear(linesRaw, 'Desc_Linha', 15);
  const totalLinhas = linesRaw.reduce((s, l) => s + (l.resultadoLiquido || 0), 0);
  lines.forEach(l => { l.pctTotal = totalLinhas > 0 ? (l.resultadoLiquido / totalLinhas) * 100 : 0; });

  const subgroupsRaw = enriquecerComMoM(currentData?.subgroups || [], 'Desc_Subgrupo', prevSubgroupsMap);
  const subgroups = rankear(subgroupsRaw, 'Desc_Subgrupo', 15);
  const totalSubgrupos = subgroupsRaw.reduce((s, sg) => s + (sg.resultadoLiquido || 0), 0);
  subgroups.forEach(sg => { sg.pctTotal = totalSubgrupos > 0 ? (sg.resultadoLiquido / totalSubgrupos) * 100 : 0; });

  // Dia da semana
  const weekdays = (currentData?.weekdays || []).map(w => ({
    diaSemana: w['Dia da Semana'] || 'N/A',
    resultadoLiquido: w.resultadoLiquido || 0,
    quantidade: w.quantidade || 0,
    cupons: w.cupons || 0,
    clientes: w.clientes || 0,
  }));

  // Meses disponíveis
  const mesesDisponiveis = excelReader.getMesesDisponiveis();

  // Opções de filtros disponíveis
  const allGroups = (currentData?.groups || []).map(g => g.Desc_Grupo).filter(g => g && g !== '-').sort();
  const allLines = (currentData?.lines || []).map(l => l.Desc_Linha).filter(l => l && l !== '-').sort();
  const allSubgroups = (currentData?.subgroups || []).map(sg => sg.Desc_Subgrupo).filter(sg => sg && sg !== '-').sort();

  return {
    mesAno,
    mesAnterior,
    diaCorte,
    diaHoje,
    isD1Default: isCurrentMonth && (diaCorte === Math.max(1, diaHoje - 1)),
    diasNoMes,
    mesesDisponiveis,
    opcoesFiltros: {
      grupos: Array.from(new Set(allGroups)),
      linhas: Array.from(new Set(allLines)),
      subgrupos: Array.from(new Set(allSubgroups)),
    },
    kpis: {
      ...kpisAtual,
      metaOrcada: metasAcum.totalOrcada,
      metaDesafio: metasAcum.totalDesafio,
      pctOrcada,
      pctDesafio,
      projecao,
      projecaoPctOrcada: metasAcum.totalOrcada > 0 ? (projecao / (metasAcum.totalOrcada / diaCorte * diasNoMes)) * 100 : null,
    },
    crescimento,
    daily: dailyCombined,
    channels,
    groups,
    lines,
    subgroups,
    weekdays,
    lastUpdate: new Date().toISOString(),
  };
}

/**
 * Atualiza o cache com dados novos do Qlik
 */
function updateCache(currentData, previousData, mesAno) {
  dataCache = {
    currentMonth: currentData,
    previousMonth: previousData,
    timestamp: Date.now(),
    mesAno,
  };
}

function isCacheValid(mesAno) {
  return (
    dataCache.timestamp &&
    dataCache.mesAno === mesAno &&
    (Date.now() - dataCache.timestamp) < CACHE_DURATION
  );
}

function getCache() {
  return dataCache;
}

module.exports = {
  getCurrentMonth,
  getPreviousMonth,
  buildDashboardResponse,
  updateCache,
  isCacheValid,
  getCache,
  calcularKPIs,
  combinarDailyComMetas,
};
