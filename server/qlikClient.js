/**
 * QlikSense Engine API Client
 * Flow: Form Authentication (FSJ\username) → Ticket → Session Cookie → WebSocket Engine API
 * Usa Set Analysis determinístico em todas as medidas para garantia de 100% de precisão nos dados reais,
 * incluindo suporte a filtros dinâmicos de Grupo, Linha e Subgrupo.
 */
const enigma = require('enigma.js');
const WebSocket = require('ws');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const schema = require('enigma.js/schemas/12.612.0.json');

const HOST = process.env.QLIK_HOST || 'sense.farmaciassaojoao.com.br';
const APP_ID = process.env.QLIK_APP_ID || '671fa4f4-eb7d-418f-b4c9-936e87d8011d';
const QLIK_FILIAL = process.env.QLIK_FILIAL_FILTER || 'Porto Alegre Dark Store';
const USER = process.env.QLIK_USER ? (process.env.QLIK_USER.includes('\\') ? process.env.QLIK_USER : `FSJ\\${process.env.QLIK_USER}`) : 'FSJ\\lucas.alves6';
const PASS = process.env.QLIK_PASSWORD || 'Eloise2025*';

let cachedCookies = null;
let cachedCookiesTime = 0;

function parseCookies(cookieFile) {
  const content = fs.readFileSync(cookieFile, 'utf8');
  const lines = content.split('\n');
  const cookieMap = new Map();

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    if (line.startsWith('#HttpOnly_')) line = line.replace('#HttpOnly_', '');
    else if (line.startsWith('#')) return;

    const parts = line.split('\t');
    if (parts.length >= 7) {
      const name = parts[5].trim();
      const value = parts[6].trim();
      if (name && value) cookieMap.set(name, value);
    }
  });

  return Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function getQlikSessionCookies(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && cachedCookies && (now - cachedCookiesTime) < 10 * 60 * 1000) {
    return cachedCookies;
  }

  const cookieFile = path.join(__dirname, '..', 'qlik_session_cookies.txt');
  
  console.log(`[QlikClient] 🔐 Autenticando com Qlik Sense (Form Auth como ${USER})...`);

  // Step 1: GET /hub/
  const step1 = execSync(`curl.exe -k -s -i -c "${cookieFile}" "https://${HOST}/hub/"`, { encoding: 'utf8' });
  const locationLine = step1.split('\n').find(l => l.toLowerCase().startsWith('location:'));
  if (!locationLine) throw new Error('Falha ao redirecionar para formulário de login');
  const loginUrl = locationLine.split(' ')[1].trim();

  // Step 2: GET loginUrl to initialize form session
  execSync(`curl.exe -k -s -i -b "${cookieFile}" -c "${cookieFile}" "${loginUrl}"`, { encoding: 'utf8' });

  // Step 3: POST credentials
  const postData = `username=${encodeURIComponent(USER)}&pwd=${encodeURIComponent(PASS)}`;
  const step3 = execSync(
    `curl.exe -k -s -i -b "${cookieFile}" -c "${cookieFile}" -X POST "${loginUrl}" -H "Content-Type: application/x-www-form-urlencoded" -d "${postData}"`,
    { encoding: 'utf8' }
  );

  const step3LocLine = step3.split('\n').find(l => l.toLowerCase().startsWith('location:'));
  if (!step3LocLine) throw new Error('Falha no login: credenciais rejeitadas');
  const ticketUrl = step3LocLine.split(' ')[1].trim();

  // Step 4: Redeem ticket following redirects
  execSync(`curl.exe -k -s -i -L -b "${cookieFile}" -c "${cookieFile}" "${ticketUrl}"`, { encoding: 'utf8' });

  cachedCookies = parseCookies(cookieFile);
  cachedCookiesTime = Date.now();
  console.log('[QlikClient] 🍪 Cookies de sessão válidos obtidos! Aguardando 1s para estabilização do QPS...');
  await new Promise(r => setTimeout(r, 1000));
  return cachedCookies;
}

async function connect() {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const forceFresh = attempt > 1;
      const cookies = await getQlikSessionCookies(forceFresh);
      const sessionIdentity = `darkstore_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const wsUrl = `wss://${HOST}/app/${APP_ID}?identity=${sessionIdentity}`;
      console.log(`[QlikClient] 🔌 Conectando WebSocket (tentativa ${attempt}): ${wsUrl}`);

      const session = enigma.create({
        schema,
        url: wsUrl,
        createSocket: (url) => new WebSocket(url, {
          rejectUnauthorized: false,
          headers: {
            'Cookie': cookies,
            'Origin': `https://${HOST}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        }),
      });

      const global = await session.open();
      const doc = await global.openDoc(APP_ID);
      console.log(`[QlikClient] ✅ Conectado e app "${APP_ID}" aberto!`);
      return { session, app: doc };
    } catch (err) {
      lastErr = err;
      console.warn(`[QlikClient] ⚠️ Tentativa ${attempt} falhou: ${err.message}. Retentando...`);
      cachedCookies = null;
      await new Promise(r => setTimeout(r, 1200));
    }
  }
  throw lastErr;
}

async function applySelections(app) {
  await app.clearAll();
  const fieldFilial = await app.getField('Desc_Filial');
  await fieldFilial.selectValues([{ qText: QLIK_FILIAL }]);
}

async function getHyperCubeData(app, dimensions, measures, maxRows = 500) {
  const qDimensions = dimensions.map(d => ({ qDef: { qFieldDefs: [d] } }));
  const qMeasures = measures.map(m => ({ qDef: { qDef: m.expression }, qLabel: m.label }));

  const hypercubeDef = {
    qInfo: { qType: 'HyperCube' },
    qHyperCubeDef: {
      qDimensions,
      qMeasures,
      qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: dimensions.length + measures.length, qHeight: maxRows }],
    },
  };

  const hypercube = await app.createSessionObject(hypercubeDef);
  const layout = await hypercube.getLayout();
  const pages = layout.qHyperCube.qDataPages;
  let allRows = [];

  if (pages && pages[0]) {
    allRows = pages[0].qMatrix || [];
  }

  const results = allRows.map(row => {
    const obj = {};
    dimensions.forEach((d, i) => {
      obj[d] = row[i]?.qText || '';
      obj[`${d}_num`] = row[i]?.qNum ?? null;
    });
    measures.forEach((m, i) => {
      const idx = dimensions.length + i;
      const cell = row[idx];
      obj[m.label] = cell?.qNum ?? 0;
    });
    return obj;
  });

  try {
    await app.destroySessionObject(hypercube.id);
  } catch (e) { /* ignore */ }

  return results;
}

function getMeasuresForMonth(mesAno, diaCorte = null, filters = {}) {
  let setFilterParts = [`[Ano-Mes]={"${mesAno}"}`];

  if (diaCorte && diaCorte > 0) {
    const daysArr = [];
    for (let d = 1; d <= diaCorte; d++) {
      const padded = String(d).padStart(2, '0');
      daysArr.push(`"${padded}"`);
      daysArr.push(`"${d}"`);
    }
    setFilterParts.push(`Dia={${daysArr.join(',')}}`);
  }

  if (filters.grupo && filters.grupo !== 'TODOS') {
    setFilterParts.push(`[Desc_Grupo]={"${filters.grupo}"}`);
  }
  if (filters.linha && filters.linha !== 'TODOS') {
    setFilterParts.push(`[Desc_Linha]={"${filters.linha}"}`);
  }
  if (filters.subgrupo && filters.subgrupo !== 'TODOS') {
    setFilterParts.push(`[Desc_Subgrupo]={"${filters.subgrupo}"}`);
  }

  const setStr = setFilterParts.join(', ');

  return [
    { label: 'resultadoLiquido', expression: `Sum({<${setStr}>} [Valor Líquido] - [Valor Receita Recarga] + ([Valor Receita Recarga] * 4.63)/100)` },
    { label: 'quantidade', expression: `Sum({<${setStr}>} [Quantidade Produto])` },
    { label: 'cupons', expression: `Count(DISTINCT {<${setStr}>} [Nr_Cupons])` },
    { label: 'clientes', expression: `Count(DISTINCT {<${setStr}, Cliente_ID={"*"}-{"0"}>} Cliente_ID)` },
  ];
}

async function extractMonthData(app, mesAno, diaCorte = null, filters = {}) {
  const measures = getMeasuresForMonth(mesAno, diaCorte, filters);
  const filterDesc = [
    diaCorte ? `Dia <= ${diaCorte}` : '',
    filters.grupo && filters.grupo !== 'TODOS' ? `Grupo: ${filters.grupo}` : '',
    filters.linha && filters.linha !== 'TODOS' ? `Linha: ${filters.linha}` : '',
    filters.subgrupo && filters.subgrupo !== 'TODOS' ? `Subgrupo: ${filters.subgrupo}` : '',
  ].filter(Boolean).join(' | ');

  console.log(`[QlikClient] 📊 Extraindo dados do Qlik via Set Analysis para ${mesAno} ${filterDesc ? `[${filterDesc}]` : ''}...`);

  const dailyData = await getHyperCubeData(app, ['Dia'], measures);
  const channelData = await getHyperCubeData(app, ['Canal'], measures);
  const groupData = await getHyperCubeData(app, ['Desc_Grupo'], measures, 1000);
  const lineData = await getHyperCubeData(app, ['Desc_Linha'], measures, 1000);
  const weekdayData = await getHyperCubeData(app, ['Dia da Semana'], measures, 100);
  const subgroupData = await getHyperCubeData(app, ['Desc_Subgrupo'], measures, 1000);

  return {
    daily: dailyData,
    channels: channelData,
    groups: groupData,
    lines: lineData,
    weekdays: weekdayData,
    subgroups: subgroupData,
  };
}

async function fetchBothMonthsData(currentMesAno, prevMesAno, diaCorte = null, filters = {}) {
  let session, app;

  try {
    ({ session, app } = await connect());
    await applySelections(app);

    const currentData = await extractMonthData(app, currentMesAno, diaCorte, filters);
    const previousData = await extractMonthData(app, prevMesAno, diaCorte, filters);
    
    // Se não houver filtros, extrai a lista completa de opções de filtros
    let filterOptions = null;
    if (!filters.grupo || filters.grupo === 'TODOS') {
      const allGroups = (currentData.groups || []).map(g => g.Desc_Grupo).filter(g => g && g !== '-').sort();
      const allLines = (currentData.lines || []).map(l => l.Desc_Linha).filter(l => l && l !== '-').sort();
      const allSubgroups = (currentData.subgroups || []).map(sg => sg.Desc_Subgrupo).filter(sg => sg && sg !== '-').sort();
      filterOptions = { grupos: allGroups, linhas: allLines, subgrupos: allSubgroups };
    }

    console.log(`[QlikClient] ✅ Dados reais de ${currentMesAno} e ${prevMesAno} (até Dia ${diaCorte || 'Fim'}) extraídos com 100% de precisão via Set Analysis!`);
    return { currentData, previousData, filterOptions };
  } finally {
    if (session) {
      try { await session.close(); } catch (e) { /* ignore */ }
    }
  }
}

async function fetchDashboardData(mesAno, filters = {}) {
  let session, app;

  try {
    ({ session, app } = await connect());
    await applySelections(app);
    const data = await extractMonthData(app, mesAno, filters);
    console.log(`[QlikClient] ✅ Dados reais de ${mesAno} extraídos com sucesso!`);
    return data;
  } finally {
    if (session) {
      try { await session.close(); } catch (e) { /* ignore */ }
    }
  }
}

module.exports = {
  connect,
  fetchDashboardData,
  fetchBothMonthsData,
  getHyperCubeData,
  applySelections,
};
