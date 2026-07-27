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
/**
 * Combina dados diários do Qlik com metas do Excel
 */
function combinarDailyComMetas(dailyData, metas, mesAno, dataInicio = null, dataFim = null) {
  const weekdaysMap = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const realMap = {};
  for (const d of dailyData) {
    if (d.dataStr) realMap[d.dataStr] = d;
  }

  const metaMap = {};
  for (const m of metas) {
    if (m.dataStr) metaMap[m.dataStr] = m;
  }

  if (dataInicio && dataFim) {
    const start = new Date(dataInicio + 'T00:00:00');
    const end = new Date(dataFim + 'T00:00:00');

    let acumReal = 0, acumOrcada = 0, acumDesafio = 0;
    const combined = [];

    for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
      const yearStr = dt.getFullYear();
      const monthStr = String(dt.getMonth() + 1).padStart(2, '0');
      const dayStr = String(dt.getDate()).padStart(2, '0');
      const dataStr = `${yearStr}-${monthStr}-${dayStr}`;

      const real = realMap[dataStr] || {};
      const meta = metaMap[dataStr] || {};

      const resultadoLiquido = real.resultadoLiquido || 0;
      const metaOrcada = meta.metaOrcada || 0;
      const metaDesafio = meta.metaDesafio || 0;

      acumReal += resultadoLiquido;
      acumOrcada += metaOrcada;
      acumDesafio += metaDesafio;

      const diaSemana = weekdaysMap[dt.getDay()];
      const dataFmt = `${dayStr}/${monthStr}`;
      const labelCompleto = `${dataFmt} (${diaSemana})`;

      const cupons = real.cupons || 0;
      const clientes = real.clientes || 0;
      const quantidade = real.quantidade || 0;

      combined.push({
        dia: dt.getDate(),
        dataStr,
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

  // Fallback single month
  const parts = (mesAno || getCurrentMonth()).split('-');
  const year = parseInt(parts[0]) || new Date().getFullYear();
  const month = parseInt(parts[1]) || (new Date().getMonth() + 1);

  const metaMapDay = {};
  for (const m of metas) metaMapDay[m.dia] = m;

  const realMapDay = {};
  for (const d of dailyData) {
    const dia = parseInt(d.Dia || d['Dia_num'] || 0);
    if (dia > 0) realMapDay[dia] = d;
  }

  const maxDia = Math.max(...Object.keys(metaMapDay).map(Number), ...Object.keys(realMapDay).map(Number), 1);
  let acumReal = 0, acumOrcada = 0, acumDesafio = 0;
  const combined = [];

  for (let dia = 1; dia <= maxDia; dia++) {
    const real = realMapDay[dia] || {};
    const meta = metaMapDay[dia] || {};

    const resultadoLiquido = real.resultadoLiquido || 0;
    const metaOrcada = meta.metaOrcada || 0;
    const metaDesafio = meta.metaDesafio || 0;

    acumReal += resultadoLiquido;
    acumOrcada += metaOrcada;
    acumDesafio += metaDesafio;

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
 * Agrupa os dados diários combinados em blocos semanais
 */
function agruparPorSemana(dailyCombined, mesAno) {
  const semanasMap = new Map();
  let dayCounter = 0;

  for (const d of dailyCombined) {
    dayCounter++;
    let semIdx = Math.floor((dayCounter - 1) / 7) + 1;
    const key = `Semana ${semIdx}`;

    if (!semanasMap.has(key)) {
      semanasMap.set(key, {
        semanaKey: key,
        startLabel: d.dataFmt || `Dia ${d.dia}`,
        endLabel: d.dataFmt || `Dia ${d.dia}`,
        dia: semIdx,
        resultadoLiquido: 0,
        quantidade: 0,
        cupons: 0,
        clientes: 0,
        metaOrcada: 0,
        metaDesafio: 0,
        acumReal: 0,
        acumOrcada: 0,
        acumDesafio: 0,
        diasCount: 0,
        temDados: false,
      });
    }

    const sem = semanasMap.get(key);
    sem.endLabel = d.dataFmt || `Dia ${d.dia}`;
    sem.resultadoLiquido += d.resultadoLiquido || 0;
    sem.quantidade += d.quantidade || 0;
    sem.cupons += d.cupons || 0;
    sem.clientes += d.clientes || 0;
    sem.metaOrcada += d.metaOrcada || 0;
    sem.metaDesafio += d.metaDesafio || 0;
    sem.acumReal = d.acumReal;
    sem.acumOrcada = d.acumOrcada;
    sem.acumDesafio = d.acumDesafio;
    sem.diasCount += 1;
    if (d.temDados) sem.temDados = true;
  }

  return Array.from(semanasMap.values()).map(sem => {
    const cupons = sem.cupons || 0;
    const clientes = sem.clientes || 0;
    return {
      ...sem,
      labelCompleto: `Sem ${sem.dia} (${sem.startLabel} - ${sem.endLabel})`,
      ticketMedio: cupons > 0 ? sem.resultadoLiquido / cupons : 0,
      itensPorNota: cupons > 0 ? sem.quantidade / cupons : 0,
      itensPorCliente: clientes > 0 ? sem.quantidade / clientes : 0,
      cuponsPorCliente: clientes > 0 ? sem.cupons / clientes : 0,
      ticketPorCliente: clientes > 0 ? sem.resultadoLiquido / clientes : 0,
    };
  });
}

/**
 * Monta resposta completa do dashboard
 */
function buildDashboardResponse(currentData, previousData, mesAno, diaAteParam = null, diaDeParam = null, dataInicioParam = null, dataFimParam = null) {
  const isCurrentMonth = mesAno === getCurrentMonth();
  const diaHoje = getDiaAtual();
  const diasNoMes = new Date(parseInt(mesAno.split('-')[0]), parseInt(mesAno.split('-')[1]), 0).getDate();

  let dataInicio = dataInicioParam;
  let dataFim = dataFimParam;
  let diaDe, diaCorte;

  if (dataInicio && dataFim) {
    const startParts = dataInicio.split('-');
    const endParts = dataFim.split('-');
    if (startParts.length === 3 && endParts.length === 3) {
      diaDe = parseInt(startParts[2]);
      diaCorte = parseInt(endParts[2]);
      mesAno = `${endParts[0]}-${endParts[1]}`;
    }
  }

  if (diaDe == null) {
    diaDe = diaDeParam != null && !isNaN(diaDeParam) ? Math.min(Math.max(1, diaDeParam), diasNoMes) : 1;
  }
  if (diaCorte == null) {
    if (diaAteParam != null && !isNaN(diaAteParam)) {
      diaCorte = Math.min(Math.max(diaDe, diaAteParam), diasNoMes);
    } else if (isCurrentMonth) {
      diaCorte = Math.max(1, diaHoje - 1);
    } else {
      diaCorte = diasNoMes;
    }
  }

  // Se não vieram datas absolutas YYYY-MM-DD, gera com base no mês e diaDe/diaCorte
  if (!dataInicio || !dataFim) {
    const monthStr = String(mesAno).slice(0, 7);
    const startStr = String(diaDe).padStart(2, '0');
    const endStr = String(diaCorte).padStart(2, '0');
    dataInicio = `${monthStr}-${startStr}`;
    dataFim = `${monthStr}-${endStr}`;
  }

  const mesAnterior = getPreviousMonth(mesAno);

  // Metas do Excel no intervalo de datas
  const metasAtual = excelReader.readAllMetas();
  const metasAcum = excelReader.getMetasForDateRange(dataInicio, dataFim);

  // KPIs mês atual (filtrados no intervalo de datas)
  const dailyAtual = currentData?.daily || [];
  const dailyAtualAteDia = dailyAtual.filter(d => {
    if (d.dataStr) return d.dataStr >= dataInicio && d.dataStr <= dataFim;
    const dia = parseInt(d.Dia || d.dia || 0);
    return dia >= diaDe && dia <= diaCorte;
  });
  const kpisAtual = calcularKPIs(dailyAtualAteDia);

  // KPIs mês anterior (mesmo período deslocado para o mês anterior)
  const dailyAnterior = previousData?.daily || [];

  // Calcular as datas equivalentes no mês anterior para filtragem correta
  let prevDataInicio, prevDataFim;
  if (dataInicio && dataFim) {
    const startDate = new Date(dataInicio + 'T00:00:00');
    const endDate = new Date(dataFim + 'T00:00:00');
    const prevStart = new Date(startDate.getFullYear(), startDate.getMonth() - 1, startDate.getDate());
    const prevEnd = new Date(endDate.getFullYear(), endDate.getMonth() - 1, endDate.getDate());
    // Ajustar se o dia não existe no mês anterior (ex: 31 em mês com 30 dias)
    const maxDayPrevMonth = new Date(prevStart.getFullYear(), prevStart.getMonth() + 1, 0).getDate();
    if (prevEnd.getDate() !== endDate.getDate()) {
      prevEnd.setDate(0); // último dia do mês anterior ao que tentamos
    }
    prevDataInicio = `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2, '0')}-${String(prevStart.getDate()).padStart(2, '0')}`;
    prevDataFim = `${prevEnd.getFullYear()}-${String(prevEnd.getMonth() + 1).padStart(2, '0')}-${String(prevEnd.getDate()).padStart(2, '0')}`;
  } else {
    // Fallback: usar mesAnterior com mesmo diaDe/diaCorte
    const [prevY, prevM] = mesAnterior.split('-');
    prevDataInicio = `${prevY}-${prevM}-${String(diaDe).padStart(2, '0')}`;
    const maxDayPrev = new Date(parseInt(prevY), parseInt(prevM), 0).getDate();
    const prevDiaCorte = Math.min(diaCorte, maxDayPrev);
    prevDataFim = `${prevY}-${prevM}-${String(prevDiaCorte).padStart(2, '0')}`;
  }

  const dailyAnteriorAteDia = dailyAnterior.filter(d => {
    if (d.dataStr) return d.dataStr >= prevDataInicio && d.dataStr <= prevDataFim;
    const dia = parseInt(d.Dia || d.dia || 0);
    return dia >= diaDe && dia <= diaCorte;
  });
  const kpisAnterior = calcularKPIs(dailyAnteriorAteDia);

  // Crescimento MoM
  const crescimento = calcularCrescimento(kpisAtual, kpisAnterior);

  // Combinar daily com metas no intervalo selecionado
  const dailyCombined = combinarDailyComMetas(dailyAtual, metasAtual, mesAno, dataInicio, dataFim);

  // Agrupamento semanal para alternância Dia / Semana
  const weekly = agruparPorSemana(dailyCombined, mesAno);

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
    diaDe,
    diaCorte,
    diaHoje,
    dataInicio,
    dataFim,
    isD1Default: isCurrentMonth && (diaCorte === Math.max(1, diaHoje - 1)) && diaDe === 1,
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
      projecaoPctOrcada: metasAcum.totalOrcada > 0 ? (projecao / (metasAcum.totalOrcada / (diaCorte - diaDe + 1) * diasNoMes)) * 100 : null,
    },
    crescimento,
    daily: dailyCombined,
    weekly,
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
  agruparPorSemana,
};

