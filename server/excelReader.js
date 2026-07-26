/**
 * Excel Reader — Leitura de Metas Diárias do arquivo Excel
 * Lê as colunas DATA, Meta Orçada e Meta Desafio
 */
const XLSX = require('xlsx');
const path = require('path');

const EXCEL_PATH = process.env.EXCEL_PATH || './Metas Diarias DASKStore.xlsx';

/**
 * Lê todas as metas do Excel e retorna array estruturado
 */
function readAllMetas() {
  const filePath = path.resolve(__dirname, '..', EXCEL_PATH);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Pula header (row 0)
  const metas = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;

    // XLSX retorna datas como serial numbers
    let dateValue = row[0];
    let date;
    if (typeof dateValue === 'number') {
      date = XLSX.SSF.parse_date_code(dateValue);
      date = new Date(date.y, date.m - 1, date.d);
    } else if (dateValue instanceof Date) {
      date = dateValue;
    } else {
      continue;
    }

    const yearStr = date.getFullYear();
    const monthStr = String(date.getMonth() + 1).padStart(2, '0');
    const dayStr = String(date.getDate()).padStart(2, '0');
    const dataStr = `${yearStr}-${monthStr}-${dayStr}`;

    metas.push({
      data: date,
      dataStr,
      dia: date.getDate(),
      mes: date.getMonth() + 1,
      ano: date.getFullYear(),
      mesAno: `${yearStr}-${monthStr}`,
      metaOrcada: row[1] || 0,
      metaDesafio: row[2] || 0,
    });
  }

  return metas;
}

/**
 * Retorna metas em um intervalo de datas absoluto ("YYYY-MM-DD" ate "YYYY-MM-DD")
 */
function getMetasForDateRange(startDateStr, endDateStr) {
  const all = readAllMetas();
  const filtered = all.filter(m => (!startDateStr || m.dataStr >= startDateStr) && (!endDateStr || m.dataStr <= endDateStr));
  const totalOrcada = filtered.reduce((s, m) => s + (m.metaOrcada || 0), 0);
  const totalDesafio = filtered.reduce((s, m) => s + (m.metaDesafio || 0), 0);
  return {
    metas: filtered,
    totalOrcada,
    totalDesafio,
  };
}

/**
 * Retorna metas filtradas por mês (formato: "YYYY-MM")
 */
function getMetasByMonth(mesAno) {
  const all = readAllMetas();
  return all.filter(m => m.mesAno === mesAno);
}

/**
 * Retorna metas acumuladas até um determinado dia do mês
 */
function getMetasAcumuladas(mesAno, ateDia = 31) {
  return getMetasIntervalo(mesAno, 1, ateDia);
}

/**
 * Retorna metas em um intervalo de dias (deDia ate ateDia)
 */
function getMetasIntervalo(mesAno, deDia = 1, ateDia = 31) {
  const metas = getMetasByMonth(mesAno);
  let acumOrcada = 0;
  let acumDesafio = 0;
  const diario = [];

  for (const m of metas) {
    if (m.dia >= deDia && m.dia <= ateDia) {
      acumOrcada += m.metaOrcada;
      acumDesafio += m.metaDesafio;
    }
    diario.push({
      dia: m.dia,
      data: m.data,
      metaOrcada: m.metaOrcada,
      metaDesafio: m.metaDesafio,
      metaOrcadaAcum: (m.dia >= deDia && m.dia <= ateDia) ? acumOrcada : null,
      metaDesafioAcum: (m.dia >= deDia && m.dia <= ateDia) ? acumDesafio : null,
    });
  }

  return {
    mesAno,
    totalOrcada: acumOrcada,
    totalDesafio: acumDesafio,
    diario,
  };
}

/**
 * Retorna lista de meses disponíveis no Excel
 */
function getMesesDisponiveis() {
  const all = readAllMetas();
  const meses = new Set();
  for (const m of all) {
    if (m.metaOrcada > 0 || m.metaDesafio > 0) {
      meses.add(m.mesAno);
    }
  }
  return Array.from(meses).sort();
}

module.exports = {
  readAllMetas,
  getMetasByMonth,
  getMetasAcumuladas,
  getMetasIntervalo,
  getMetasForDateRange,
  getMesesDisponiveis,
};

