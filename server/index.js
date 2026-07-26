const fs = require('fs');
/**
 * Dashboard DARK Store — Express Server
 * API endpoints para o dashboard de indicadores
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const qlikClient = require('./qlikClient');
const dataService = require('./dataService');
const excelReader = require('./excelReader');

const app = express();
const PORT = process.env.PORT || 8094;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// =========================================================
// Variáveis de controle
// =========================================================
let lastQlikData = null;
let lastQlikPrevData = null;
let qlikConnected = false;
let qlikError = null;

// =========================================================
// Tenta carregar dados do Qlik na inicialização e em background
// =========================================================
async function loadQlikData(mesAno, diaCorte = null, filters = {}) {
  try {
    console.log(`[Server] 🔄 Buscando dados do Qlik para ${mesAno} (até dia ${diaCorte || 'Fim'}) e mês anterior em sessão única...`);
    const mesAnterior = dataService.getPreviousMonth(mesAno);

    const { currentData, previousData } = await qlikClient.fetchBothMonthsData(mesAno, mesAnterior, diaCorte, filters);

    const hasActiveFilters = (filters.grupo && filters.grupo !== 'TODOS') ||
                             (filters.linha && filters.linha !== 'TODOS') ||
                             (filters.subgrupo && filters.subgrupo !== 'TODOS');

    if (!hasActiveFilters && !diaCorte) {
      lastQlikData = currentData;
      lastQlikPrevData = previousData;
      dataService.updateCache(currentData, previousData, mesAno);

      // Persiste em disco para acelerar respostas e garantir fallback atualizado
      const dumpPath = path.join(__dirname, 'cached_real_qlik_data.json');
      try {
        fs.writeFileSync(dumpPath, JSON.stringify({ currentData, previousData, timestamp: new Date().toISOString() }, null, 2));
        console.log('[Server] 💾 Cache persistido atualizado com sucesso em cached_real_qlik_data.json');
      } catch (e) {
        console.error('[Server] ⚠️ Erro ao salvar cached_real_qlik_data.json:', e.message);
      }
    }
    qlikConnected = true;
    qlikError = null;

    console.log(`[Server] ✅ Dados Qlik de ambos os meses (até dia ${diaCorte || 'Fim'}) carregados com sucesso!`);
    return { currentData, previousData };
  } catch (err) {
    qlikConnected = false;
    qlikError = err.message;
    console.error(`[Server] ❌ Erro ao conectar ao Qlik: ${err.message}`);
    console.error(`[Server] ℹ️  Dashboard rodará com dados de demonstração ou cache local. Configure a autenticação no .env`);
    return null;
  }
}

// =========================================================
// DADOS DE DEMONSTRAÇÃO (quando Qlik não está acessível)
// =========================================================
function generateDemoData(mesAno) {
  const metas = excelReader.getMetasByMonth(mesAno);
  const diaAtual = mesAno === dataService.getCurrentMonth() ? new Date().getDate() : 31;
  const diasSemana = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

  // Gera dados realistas baseados nas metas
  const daily = [];
  for (let dia = 1; dia <= diaAtual; dia++) {
    const meta = metas.find(m => m.dia === dia);
    const metaOrcada = meta?.metaOrcada || 30000;
    // Variação aleatória entre 80% e 130% da meta
    const fator = 0.80 + Math.random() * 0.50;
    const rl = Math.round(metaOrcada * fator);
    const cupons = Math.round(80 + Math.random() * 120);
    const clientes = Math.round(cupons * (0.7 + Math.random() * 0.3));
    const qty = Math.round(cupons * (2.5 + Math.random() * 2));

    daily.push({
      Dia: String(dia),
      Dia_num: dia,
      resultadoLiquido: rl,
      quantidade: qty,
      cupons: cupons,
      clientes: clientes,
    });
  }

  const totalRL = daily.reduce((s, d) => s + d.resultadoLiquido, 0);

  const channels = [
    'APP Tele Entrega', 'SITE Tele Entrega', 'iFood', 'e_Commerce',
    'Venda Tele Entrega Central', 'Venda Balcão', 'SITE', 'APP'
  ].map((c, i) => ({
    Canal: c,
    resultadoLiquido: Math.round(totalRL * (0.35 - i * 0.04)),
    quantidade: Math.round((totalRL * (0.35 - i * 0.04)) / 20),
    cupons: Math.round((totalRL * (0.35 - i * 0.04)) / 120),
    clientes: Math.round((totalRL * (0.35 - i * 0.04)) / 160),
  }));

  // Grupos
  const groups = [
    'Medicamentos(1)', 'Perfumaria(2)', 'Conveniencia(10)', 'Nutricao(3090)',
    'Dermo-Cosmeticos(3089)', 'Diversos(5)'
  ].map((g, i) => ({
    Desc_Grupo: g,
    resultadoLiquido: Math.round(totalRL * (0.45 - i * 0.07)),
    quantidade: Math.round((totalRL * (0.45 - i * 0.07)) / 15),
    cupons: Math.round((totalRL * (0.45 - i * 0.07)) / 100),
    clientes: Math.round((totalRL * (0.45 - i * 0.07)) / 140),
  }));

  // Linhas (sub de grupos)
  const lines = [
    'ANTIDIABETICOS', 'FRALDAS INFANTIS', 'ANTIDEPRESSIVOS / ESTABIL HUMOR',
    'VITAMINAS E SUPLEMENTOS MINERAIS', 'OTC- VITAMINAS E SUPLEMENTOS MINERAIS',
    'TOALHAS UMEDECIDAS - INFANTIL', 'ANTI-HIPERTENSIVOS', 'MEDICAMENTOS FARMACIA POPULAR',
    'PRIMEIROS SOCORROS', 'ALIMENTOS'
  ].map((l, i) => ({
    Desc_Linha: l,
    resultadoLiquido: Math.round(totalRL * (0.15 - i * 0.012)),
    quantidade: Math.round((totalRL * (0.15 - i * 0.012)) / 25),
    cupons: Math.round((totalRL * (0.15 - i * 0.012)) / 180),
    clientes: Math.round((totalRL * (0.15 - i * 0.012)) / 220),
  }));

  // Subgrupos
  const subgroups = [
    'Genéricos - Marca(0301)', 'Analgésicos(0102)', 'Shampoo(0203)',
    'Fraldas Descartáveis(0601)', 'Protetor Solar(0504)', 'Vitaminas(0801)',
  ].map((s, i) => ({
    Desc_Subgrupo: s,
    resultadoLiquido: Math.round(totalRL * (0.10 - i * 0.012)),
    quantidade: Math.round((totalRL * (0.10 - i * 0.012)) / 20),
    cupons: Math.round((totalRL * (0.10 - i * 0.012)) / 150),
    clientes: Math.round((totalRL * (0.10 - i * 0.012)) / 200),
  }));

  // Weekdays
  const weekdays = diasSemana.map(d => {
    const daysInWeek = daily.filter((_, i) => {
      const date = new Date(2026, parseInt(mesAno.split('-')[1]) - 1, i + 1);
      return diasSemana[date.getDay() === 0 ? 6 : date.getDay() - 1] === d;
    });
    const sum = daysInWeek.reduce((s, dd) => s + dd.resultadoLiquido, 0);
    return {
      'Dia da Semana': d,
      resultadoLiquido: sum || Math.round(totalRL / 7),
      quantidade: Math.round((sum || totalRL / 7) / 25),
      cupons: Math.round((sum || totalRL / 7) / 180),
      clientes: Math.round((sum || totalRL / 7) / 220),
    };
  });

  return { daily, channels, groups, lines, subgroups, weekdays };
}

// =========================================================
// API ENDPOINTS
// =========================================================

/**
 * GET /api/dashboard — Dados completos do dashboard
 * Query params: ?mes=YYYY-MM & diaAte=X & grupo=... & linha=... & subgrupo=...
 */
app.get('/api/dashboard', async (req, res) => {
  try {
    const mesAno = req.query.mes || dataService.getCurrentMonth();
    const isCurrentMonth = mesAno === dataService.getCurrentMonth();
    const diaHoje = new Date().getDate();
    const diaAte = req.query.diaAte ? parseInt(req.query.diaAte) : (isCurrentMonth ? Math.max(1, diaHoje - 1) : null);
    
    const filters = {
      grupo: req.query.grupo || 'TODOS',
      linha: req.query.linha || 'TODOS',
      subgrupo: req.query.subgrupo || 'TODOS',
    };

    let currentData, previousData;

    // Se a conexão estive ativa ou o cache expirou, busca no Qlik
    if (qlikConnected || !dataService.isCacheValid(mesAno)) {
      const result = await loadQlikData(mesAno, diaAte, filters);
      if (result) {
        currentData = result.currentData;
        previousData = result.previousData;
      }
    } else {
      const cache = dataService.getCache();
      if (cache.currentMonth && cache.previousMonth) {
        currentData = cache.currentMonth;
        previousData = cache.previousMonth;
      }
    }

    let usingCachedRealData = false;
    if (!currentData) {
      // Tenta carregar os dados reais extraídos e persistidos do Qlik Sense
      const dumpPath = path.join(__dirname, 'cached_real_qlik_data.json');
      if (fs.existsSync(dumpPath)) {
        try {
          const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
          currentData = dump.currentData;
          previousData = dump.previousData;
          usingCachedRealData = true;
          console.log('[Server] 📦 Dados REAIS persistidos do Qlik carregados com sucesso!');
        } catch (e) {
          console.error('[Server] ⚠️ Erro ao ler cached_real_qlik_data.json:', e.message);
        }
      }

      if (!currentData) {
        currentData = generateDemoData(mesAno);
        const mesAnterior = dataService.getPreviousMonth(mesAno);
        previousData = generateDemoData(mesAnterior);
      }
    }

    const response = dataService.buildDashboardResponse(currentData, previousData, mesAno, diaAte);
    response.qlikConnected = qlikConnected || usingCachedRealData;
    response.qlikError = qlikConnected ? null : (usingCachedRealData ? null : qlikError);
    response.isDemo = !qlikConnected && !usingCachedRealData;
    response.filtrosAtivos = filters;

    res.json({ success: true, data: response });
  } catch (err) {
    console.error('[API] Erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/meses — Lista meses com metas disponíveis
 */
app.get('/api/meses', (req, res) => {
  try {
    const meses = excelReader.getMesesDisponiveis();
    res.json({ success: true, data: meses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/status — Status da conexão com Qlik
 */
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    data: {
      qlikConnected,
      qlikError,
      qlikHost: process.env.QLIK_HOST,
      appId: process.env.QLIK_APP_ID,
      lastUpdate: dataService.getCache().timestamp
        ? new Date(dataService.getCache().timestamp).toISOString()
        : new Date().toISOString(),
    },
  });
});

/**
 * POST /api/refresh — Força atualização dos dados do Qlik
 */
app.post('/api/refresh', async (req, res) => {
  try {
    const mesAno = req.body.mes || dataService.getCurrentMonth();
    const result = await loadQlikData(mesAno);
    res.json({ success: !!result, qlikConnected, qlikError });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================
// AGENDADOR AUTOMÁTICO DE SINCRONIZAÇÃO (CRON - DIARIAMENTE ÀS 07:45)
// =========================================================
cron.schedule('45 7 * * *', async () => {
  console.log('\n[Cron] ⏰ Executando sincronização diária programada com Qlik Sense (07:45 da manhã)...');
  const mesAno = dataService.getCurrentMonth();
  await loadQlikData(mesAno);
});

// =========================================================
// STARTUP
// =========================================================
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🏪 Dashboard DARK Store — Performance & Indicadores`);
  console.log(`🌐 URL: http://0.0.0.0:${PORT}`);
  console.log(`📊 Qlik Host: ${process.env.QLIK_HOST || 'N/A'}`);
  console.log(`📋 App ID: ${process.env.QLIK_APP_ID || 'N/A'}`);
  console.log(`⏰ Auto-Sync Qlik: Agendado diariamente às 07:45 da manhã`);
  console.log(`${'═'.repeat(60)}\n`);

  // Tenta conectar ao Qlik na inicialização
  const mesAno = dataService.getCurrentMonth();
  await loadQlikData(mesAno);

  if (!qlikConnected) {
    console.log(`\n⚠️  Rodando com DADOS DE DEMONSTRAÇÃO ou CACHE PERSISTIDO`);
    console.log(`   Próxima sincronização agendada para 07:45 da manhã.\n`);
  }
});

