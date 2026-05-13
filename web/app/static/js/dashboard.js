const eur = v => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v || 0);
const pct = v => (v >= 0 ? '+' : '') + (v || 0).toFixed(1) + '%';

// ─── AUTH FETCH HELPER ─────────────────────────────────────
async function tokenFetch(url, options = {}) {
    const user = auth.currentUser;
    if (!user) { window.location.href = '/'; return; }
    const token = await user.getIdToken();
    const headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    if (!(options.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; }
    options.headers = headers;
    return fetch(url, options);
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', sb.classList.contains('collapsed'));
}

let DATA, activePorts = new Set(['CASH', 'CRYPTO', 'FUNDS', 'ETFS']), tRange = 'ALL';
const charts = {};
const COLORS = {
    CASH: { bg: 'rgba(107,114,128,.5)', bd: '#6B7280' },
    CRYPTO: { bg: 'rgba(124,58,237,.5)', bd: '#7C3AED' },
    FUNDS: { bg: 'rgba(8,145,178,.5)', bd: '#0891B2' },
    ETFS: { bg: 'rgba(5,150,105,.5)', bd: '#059669' }
};
const LABELS = { CASH: 'Efectivo', CRYPTO: 'Crypto', FUNDS: 'Fondos', ETFS: 'ETFs' };
const GRP_COLORS = ['#6B7280', '#7C3AED', '#0891B2', '#059669'];

let CATEGORIES_CACHE = [];
let ALL_TRANSACTIONS = [];
let SERVER_SUBSCRIPTIONS = [];
let currentFinTxs = []; // Base para gráficos y filtros de finanzas
let selectedBreakdownMonth = 'ALL'; // Selected month for the breakdown panels
let selectedExpenseCategories = new Set(); // category names selected in treemap
let expenseCatColorMap = {};              // { catName -> hexColor } built each render
let currentBreakdownTxs = null;           // saved for subcategory re-render on toggle
let financeChart = null, retirementChart = null;
let draggedTransactionId = null;

// ─── BANK CONFIG & LOGOS ──────────────────────────────────────────────────
// color = fondo del badge | accent = color del texto de fallback (iniciales)
// Fondo blanco + accent = color de marca → favicon se ve sobre blanco
// Fondo de color (Openbank, N26) → favicon/iniciales en blanco
const BANK_CONFIG = {
    // Bancos españoles — fondo blanco, accent = color de marca
    SANTANDER:     { label: 'Santander',      color: '#fff',    accent: '#EC0000', initial: 'SAN',  fmt: 'Excel' },
    BBVA:          { label: 'BBVA',           color: '#fff',    accent: '#004481', initial: 'BBVA', fmt: 'Excel' },
    CAIXABANK:     { label: 'CaixaBank',      color: '#fff',    accent: '#007BC4', initial: 'CX',   fmt: 'Excel' },
    SABADELL:      { label: 'Sabadell',       color: '#fff',    accent: '#0099A9', initial: 'SAB',  fmt: 'Excel' },
    ING:           { label: 'ING',            color: '#fff',    accent: '#FF6200', initial: 'ING',  fmt: 'Excel' },
    BANKINTER:     { label: 'Bankinter',      color: '#fff',    accent: '#E84600', initial: 'BKT',  fmt: 'Excel' },
    OPENBANK:      { label: 'Openbank',       color: '#003087', accent: '#fff',    initial: 'OPB',  fmt: 'Excel' }, // logo blanco → fondo azul oscuro
    ABANCA:        { label: 'Abanca',         color: '#fff',    accent: '#00973A', initial: 'ABA',  fmt: 'Excel' },
    KUTXABANK:     { label: 'Kutxabank',      color: '#fff',    accent: '#C8001E', initial: 'KTX',  fmt: 'Excel' },
    UNICAJA:       { label: 'Unicaja',        color: '#fff',    accent: '#004F8B', initial: 'UNI',  fmt: 'Excel' },
    IBERCAJA:      { label: 'Ibercaja',       color: '#fff',    accent: '#E8501A', initial: 'IBC',  fmt: 'Excel' },
    CAJAMAR:       { label: 'Cajamar',        color: '#fff',    accent: '#007A40', initial: 'CAJ',  fmt: 'Excel' },
    EVOBANK:       { label: 'EVO Banco',      color: '#fff',    accent: '#6D28D9', initial: 'EVO',  fmt: 'Excel' }, // sin dominio (mismo favicon que Bankinter)
    // Brókers — fondo blanco
    TRADEREPUBLIC: { label: 'Trade Republic', color: '#fff',    accent: '#28344E', initial: 'TR',   fmt: 'CSV'   },
    MYINVESTOR:    { label: 'MyInvestor',     color: '#fff',    accent: '#0055A4', initial: 'MY',   fmt: 'Excel' },
    // Neobancos
    REVOLUT:       { label: 'Revolut',        color: '#fff',    accent: '#191C1F', initial: 'REV',  fmt: 'CSV'   },
    N26:           { label: 'N26',            color: '#00D775', accent: '#fff',    initial: 'N26',  fmt: 'CSV'   }, // verde N26
    WISE:          { label: 'Wise',           color: '#fff',    accent: '#163300', initial: 'W',    fmt: 'CSV'   },
    // Otros
    EDENRED:       { label: 'Edenred',        color: '#fff',    accent: '#E3001B', initial: 'ED',   fmt: 'Excel' },
    // Efectivo / manual
    CASH:          { label: 'Efectivo',        color: '#059669', accent: '#fff',    initial: '€',    fmt: 'Manual' },
};

const BANK_LIST = [
    { group: 'Bancos Españoles', banks: ['SANTANDER','BBVA','CAIXABANK','SABADELL','ING','BANKINTER','OPENBANK','ABANCA','KUTXABANK','UNICAJA','IBERCAJA','CAJAMAR','EVOBANK'] },
    { group: 'Brókers & Inversión', banks: ['TRADEREPUBLIC','MYINVESTOR'] },
    { group: 'Neobancos', banks: ['REVOLUT','N26','WISE'] },
    { group: 'Tarjetas & Otros', banks: ['EDENRED'] },
    { group: 'Efectivo & Manual', banks: ['CASH'] },
];

// Domain map for Google favicon service (sz=32/64 PNG, no API key needed).
// EVOBANK excluded — evobanco.com serves Bankinter's favicon (Bankinter acquired EVO).
const BANK_DOMAINS = {
    SANTANDER:     'santander.com',
    BBVA:          'bbva.com',
    CAIXABANK:     'caixabank.com',
    SABADELL:      'bancosabadell.com',
    ING:           'ing.es',
    BANKINTER:     'bankinter.com',
    OPENBANK:      'openbank.es',
    ABANCA:        'abanca.com',
    KUTXABANK:     'kutxabank.es',
    UNICAJA:       'unicajabanco.es',
    IBERCAJA:      'ibercaja.es',
    CAJAMAR:       'cajamar.es',
    TRADEREPUBLIC: 'traderepublic.com',
    MYINVESTOR:    'myinvestor.es',
    REVOLUT:       'revolut.com',
    N26:           'n26.com',
    WISE:          'wise.com',
    EDENRED:       'edenred.es',
};

// Populated by loadBankLogoColors() — maps SOURCE → '#rrggbb' from edge analysis
let _bankBgColors = {};

function _luminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function bankLogo(source, size = 22) {
    const b      = BANK_CONFIG[source] || { initial: (source || '?').substring(0, 3) };
    const domain = BANK_DOMAINS[source];
    const rnd    = Math.round(size * 0.22);
    const fs     = (b.initial || '').length >= 4 ? Math.round(size * 0.27) : Math.round(size * 0.36);

    // Prefer server-detected edge color; fall back to static config color
    const bg      = _bankBgColors[source] || b.color || '#ffffff';
    const isWhite = (bg === '#ffffff' || bg === '#fff');
    const lum     = isWhite ? 1 : _luminance(bg);
    const textCol = lum > 0.45 ? (b.accent || '#333') : '#fff';
    const border  = isWhite ? 'border:1px solid rgba(0,0,0,0.1);' : '';
    const wrap    = `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:${rnd}px;background:${bg};overflow:hidden;flex-shrink:0;box-sizing:border-box;${border}`;

    if (domain) {
        const sz    = size <= 24 ? 32 : 64;
        const pad   = Math.max(1, Math.round(size * 0.1));
        const imgSz = size - pad * 2;
        return `<span data-bl="${source}" style="${wrap}padding:${pad}px;"><img src="https://www.google.com/s2/favicons?domain=${domain}&sz=${sz}" width="${imgSz}" height="${imgSz}" style="object-fit:contain;display:block;" onerror="_blFallback(this,'${source}',${size})"></span>`;
    }
    return `<span data-bl="${source}" style="${wrap}color:${textCol};font-size:${fs}px;font-weight:800;letter-spacing:-.5px;font-family:'DM Sans',sans-serif;line-height:1;">${b.initial}</span>`;
}

function _blFallback(img, source, size) {
    const bg  = _bankBgColors[source] || BANK_CONFIG[source]?.color || '#ffffff';
    const lum = bg === '#ffffff' ? 1 : _luminance(bg);
    const col = lum > 0.45 ? (BANK_CONFIG[source]?.accent || '#333') : '#fff';
    const fs  = (BANK_CONFIG[source]?.initial || '').length >= 4 ? Math.round(size * 0.27) : Math.round(size * 0.36);
    if (img.parentElement) {
        img.parentElement.style.padding = '0';
        img.parentElement.innerHTML = `<span style="font-size:${fs}px;font-weight:800;color:${col};letter-spacing:-.5px;font-family:'DM Sans',sans-serif;line-height:1;">${BANK_CONFIG[source]?.initial || '?'}</span>`;
    }
}

async function loadBankLogoColors() {
    try {
        const r = await fetch('/api/bank-favicon-colors');
        if (!r.ok) return;
        _bankBgColors = await r.json();
        // Re-paint all already-rendered badges with the detected background
        document.querySelectorAll('[data-bl]').forEach(el => {
            const src = el.dataset.bl;
            const bg  = _bankBgColors[src];
            if (!bg) return;
            const isWhite = bg === '#ffffff';
            el.style.background = bg;
            el.style.border = isWhite ? '1px solid rgba(0,0,0,0.1)' : '';
        });
        // Re-render bank picker so button shows correct color
        initBankPicker();
    } catch (e) { console.warn('Bank logo colors unavailable:', e); }
}

// ── Custom bank picker ────────────────────────────────────────────────────
function toggleBankPicker(e) {
    e.stopPropagation();
    const menu = document.getElementById('bank-picker-menu');
    const btn  = document.getElementById('bank-picker-btn');
    if (!menu) return;
    const opening = !menu.classList.contains('open');
    menu.classList.toggle('open', opening);
    btn.classList.toggle('open', opening);
}

function closeBankPicker() {
    document.getElementById('bank-picker-menu')?.classList.remove('open');
    document.getElementById('bank-picker-btn')?.classList.remove('open');
}

function selectBank(src) {
    const b = BANK_CONFIG[src] || {};
    const inp = document.getElementById('import-source');
    if (inp) inp.value = src;
    const logoEl  = document.getElementById('bank-picker-logo');
    const labelEl = document.getElementById('bank-picker-label');
    if (logoEl)  logoEl.innerHTML = bankLogo(src, 22);
    if (labelEl) labelEl.textContent = b.label || src;
    document.querySelectorAll('.bank-picker-opt').forEach(el => {
        el.classList.toggle('selected', el.dataset.src === src);
    });
    closeBankPicker();
}

function initBankPicker() {
    const menu = document.getElementById('bank-picker-menu');
    if (!menu) return;
    let html = '';
    for (const g of BANK_LIST) {
        html += `<div class="bank-picker-group">${g.group}</div>`;
        for (const src of g.banks) {
            const b = BANK_CONFIG[src];
            if (!b) continue;
            html += `<div class="bank-picker-opt" data-src="${src}" onclick="selectBank('${src}')">
                ${bankLogo(src, 26)}
                <span class="bank-picker-opt-name">${b.label}</span>
                <span class="bank-picker-opt-fmt">${b.fmt}</span>
            </div>`;
        }
    }
    menu.innerHTML = html;
    // Close on outside click
    document.addEventListener('click', e => {
        if (!document.getElementById('bank-picker')?.contains(e.target)) closeBankPicker();
    });
    selectBank('SANTANDER');
}

// ─── INIT ─────────────────────────────────────────────────
async function init() {
    if (localStorage.getItem('sidebar-collapsed') === 'true') { document.getElementById('sidebar').classList.add('collapsed'); }

    try {
        const user = auth.currentUser;
        if (user) {
            document.getElementById('user-name').textContent = user.displayName || user.email.split('@')[0];
            if (user.photoURL) {
                document.getElementById('user-photo').style.backgroundImage = `url(${user.photoURL})`;
                document.getElementById('user-photo').textContent = '';
            } else {
                document.getElementById('user-photo').textContent = (user.displayName || user.email)[0].toUpperCase();
            }
        }

        const unlinkZone = document.getElementById('unlink-zone');
        if (unlinkZone) {
            unlinkZone.addEventListener('dragover', e => { e.preventDefault(); unlinkZone.classList.add('over'); });
            unlinkZone.addEventListener('dragleave', () => unlinkZone.classList.remove('over'));
            unlinkZone.addEventListener('drop', async e => {
                e.preventDefault(); unlinkZone.classList.remove('over');
                const txId = e.dataTransfer.getData('text/plain');
                if (txId) await unlinkTransaction(txId);
            });
        }

        const [dataResp, , txResp] = await Promise.all([
            tokenFetch('/api/data'),
            fetchCategoriesCache(),
            tokenFetch('/api/transactions')
        ]);

        DATA = await dataResp.json();
        ALL_TRANSACTIONS = await txResp.json();

        if (DATA.error) {
            DATA = { summary: { date: new Date().toISOString().split('T')[0], total: 0, profit: 0 }, current: [], history: [], alloc: [], monthly: [] };
        }
    } catch (err) { console.error('Error conectando:', err); return; }

    const s = DATA.summary;
    document.getElementById('date-pill').textContent = s.date;
    document.getElementById('sfoot').innerHTML = `UID: ${auth.currentUser.uid.substring(0, 8)}...<br>Actualizado: ${s.date}`;

    const safeRender = (name, fn) => { try { fn(); } catch (e) { console.error(`Error in ${name}:`, e); } };
    safeRender('KPIs', renderKPIs);
    safeRender('Sparklines', renderSparklines);
    safeRender('Trend', renderTrend);
    safeRender('Donut', renderDonut);
    safeRender('Monthly', renderMonthly);
    safeRender('Alloc', renderAlloc);
    safeRender('AssetPerformers', renderAssetPerformers);
    safeRender('Table', renderTable);
    initToggles(); initPills(); initSort();
    initBankPicker();
    loadBankLogoColors(); // async — updates badge colors when server responds
    showPage('dashboard');
    generatePortfolioInsight();
    checkAndShowOnboarding();
}

function showPage(page) {
    ['dashboard', 'transactions', 'finanzas', 'retirement', 'suscripciones'].forEach(p => {
        const el = document.getElementById(`page-${p}`);
        if (el) el.style.display = p === page ? 'block' : 'none';
    });
    // Sync sidebar nav
    document.querySelectorAll('.nav-item').forEach(i => {
        i.classList.toggle('active', i.id === `nav-${page}`);
        i.style.color = '';
    });
    // Sync mobile bottom nav
    document.querySelectorAll('.mobile-nav-item').forEach(i => {
        i.classList.toggle('active', i.dataset.page === page);
    });
    // Scroll to top on mobile
    if (window.innerWidth <= 768) window.scrollTo({ top: 0, behavior: 'smooth' });

    if (page === 'transactions') fetchTransactions();
    if (page === 'finanzas') loadFinanceData();
    if (page === 'retirement') loadRetirementData();
    if (page === 'suscripciones') loadSubscriptionsData();
}

async function generatePortfolioInsight() {
    const s = DATA?.summary;
    if (!s) return;
    const portfolioSummary = JSON.stringify({
        totalValue: s.total_money, totalProfit: s.total_profit, totalInvested: s.total_invested,
        twr: s.global_twr, mwr: s.global_mwr, distribution: DATA.portfolios_grouped
    });

    const textEl = document.getElementById('ai-portfolio-text');
    const itemsEl = document.getElementById('ai-portfolio-items');
    if (textEl) textEl.textContent = 'Analizando tu portfolio…';
    try {
        const res = await tokenFetch('/api/portfolio/analysis', { method: 'POST', body: JSON.stringify({ portfolio: portfolioSummary }) });
        if (!res || !res.ok) throw new Error('api_error');
        const parsed = await res.json();
        if (textEl) textEl.textContent = parsed.summary || '';
        if (itemsEl && Array.isArray(parsed.items))
            itemsEl.innerHTML = parsed.items.map(i =>
                `<div class="ai-item"><div class="ai-item-icon" style="background:rgba(37,99,235,0.08)">${i.icon}</div><span>${i.text}</span></div>`
            ).join('');
    } catch (e) {
        if (textEl) textEl.textContent = 'Análisis no disponible.';
    }
}

function renderKPIs() {
    const s = DATA.summary;
    const invBase = s.non_cash_invested > 0 ? s.non_cash_invested : s.total_invested;
    const pp = invBase > 0 ? (s.non_cash_profit / invBase * 100) : 0;
    set('k-total', eur(s.total_money)); setb('k-total-b', pct(pp), pp >= 0);
    set('k-profit', eur(s.non_cash_profit ?? s.total_profit)); setb('k-profit-b', pct(pp), (s.non_cash_profit ?? s.total_profit) >= 0);
    setv('k-twr', pct(s.global_twr), s.global_twr >= 0);
    setv('k-mwr', pct(s.global_mwr), s.global_mwr >= 0);
}
const set = (id, v) => { if (document.getElementById(id)) document.getElementById(id).textContent = v; };
const setb = (id, v, up) => { const el = document.getElementById(id); if (el) { el.textContent = v; el.className = 'badge ' + (up ? 'up' : 'down'); } };
const setv = (id, v, up) => { const el = document.getElementById(id); if (el) { el.textContent = v; el.className = 'kpi-val ' + (up ? 'up' : 'down'); } };

function renderSparklines() {
    const p = DATA.history_portfolios, d = DATA.history_global;
    const tot = d.dates.map((_, i) => (p.CASH[i] || 0) + (p.CRYPTO[i] || 0) + (p.FUNDS[i] || 0) + (p.ETFS[i] || 0));
    spark('sp-total', tot, '#15803D'); spark('sp-profit', tot.map((v, i) => v - d.invested[i]), '#15803D');
}
function spark(id, data, color) {
    const c = document.getElementById(id); if (!c) return;
    const w = c.offsetWidth || 90, h = c.offsetHeight || 45;
    c.width = w; c.height = h; const ctx = c.getContext('2d');
    const mn = Math.min(...data), mx = Math.max(...data), rg = (mx - mn) || 1;
    ctx.beginPath();
    data.forEach((v, i) => { const x = (i / (data.length - 1)) * w, y = h - ((v - mn) / rg) * h; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
}

function filteredData() {
    const { dates, invested } = DATA.history_global;
    const last = new Date(dates[dates.length - 1]); let cut = new Date('1900-01-01');
    if (tRange === '1M') { cut = new Date(last); cut.setMonth(cut.getMonth() - 1); }
    if (tRange === '3M') { cut = new Date(last); cut.setMonth(cut.getMonth() - 3); }
    if (tRange === '6M') { cut = new Date(last); cut.setMonth(cut.getMonth() - 6); }
    if (tRange === '1Y') { cut = new Date(last); cut.setFullYear(cut.getFullYear() - 1); }
    const idx = dates.reduce((a, d, i) => { if (new Date(d) >= cut) a.push(i); return a; }, []);
    const p = DATA.history_portfolios;
    return { labels: idx.map(i => dates[i]), invested: idx.map(i => invested[i]), CASH: idx.map(i => p.CASH[i] || 0), CRYPTO: idx.map(i => p.CRYPTO[i] || 0), FUNDS: idx.map(i => p.FUNDS[i] || 0), ETFS: idx.map(i => p.ETFS[i] || 0) };
}
function renderTrend(cid = 'trendChart') {
    const fd = filteredData(); const ctx = document.getElementById(cid)?.getContext('2d');
    if (!ctx) return; if (charts[cid]) charts[cid].destroy();
    const sets = ['CASH', 'CRYPTO', 'FUNDS', 'ETFS'].filter(p => activePorts.has(p)).map(p => ({ label: LABELS[p], data: fd[p], backgroundColor: COLORS[p].bg, borderColor: COLORS[p].bd, borderWidth: 1.5, fill: true, tension: .4, pointRadius: 0, stack: 'p' }));
    sets.push({ label: 'Capital Invertido', data: fd.invested, borderColor: '#0E0D0B', borderWidth: 2, borderDash: [7, 5], fill: false, tension: .4, pointRadius: 0, stack: 'i' });
    charts[cid] = new Chart(ctx, { type: 'line', data: { labels: fd.labels, datasets: sets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0E0D0B', titleColor: '#A8A49C', bodyColor: '#fff', padding: 12, cornerRadius: 8, callbacks: { label: c => ` ${c.dataset.label}: ${eur(c.parsed.y)}` } } }, scales: { x: { type: 'time', time: { tooltipFormat: 'dd MMM yyyy', displayFormats: { month: 'MMM yy', week: 'dd MMM' } }, grid: { display: false }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, maxTicksLimit: 7 } }, y: { stacked: true, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, callback: v => eur(v) } } } } });
}

function renderDonut() {
    const g = DATA.portfolios_grouped; const lbls = Object.keys(g), vals = lbls.map(k => g[k].total_val);
    const tot = vals.reduce((a, b) => a + b, 0);
    document.getElementById('dc-val').textContent = eur(tot);
    document.getElementById('donut-leg').innerHTML = lbls.map((l, i) => `
                <div class="dleg-row"><div class="dleg-dot" style="background:${GRP_COLORS[i % GRP_COLORS.length]}"></div><span class="dleg-name">${l}</span><span class="dleg-val">${eur(vals[i])}</span><span class="dleg-pct">${tot > 0 ? (vals[i] / tot * 100).toFixed(1) : 0}%</span></div>`).join('');
    const ctx = document.getElementById('donutChart').getContext('2d');
    if (charts.donut) charts.donut.destroy();
    charts.donut = new Chart(ctx, { type: 'doughnut', data: { labels: lbls, datasets: [{ data: vals, backgroundColor: GRP_COLORS, borderWidth: 0, hoverOffset: 6 }] }, options: { responsive: true, maintainAspectRatio: true, cutout: '72%', plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0E0D0B', callbacks: { label: c => ` ${eur(c.parsed)} (${tot > 0 ? (c.parsed / tot * 100).toFixed(1) : 0}%)` } } } } });
}

// Returns array of monthly snapshots {m, estimated, CASH, CASH_inv, CRYPTO, CRYPTO_inv, ...}
// Interpolated months are marked estimated:true
function getMonthlySnapshots() {
    const { dates } = DATA.history_global, p = DATA.history_portfolios, pi = DATA.history_portfolios_inv || {};
    const CATS = ['CASH', 'CRYPTO', 'FUNDS', 'ETFS'];
    const snapsByMo = {}, realMonths = new Set();

    dates.forEach((d, i) => {
        const m = d.slice(0, 7);
        const snap = {};
        CATS.forEach(k => {
            snap[k] = p[k][i] || 0;
            snap[k + '_inv'] = (pi[k] ? pi[k][i] : 0) || 0;
        });
        snapsByMo[m] = snap;
        realMonths.add(m);
    });

    const recorded = Object.keys(snapsByMo).sort();
    if (!recorded.length) return [];

    const all = [{ m: recorded[0], estimated: false, ...snapsByMo[recorded[0]] }];

    for (let i = 1; i < recorded.length; i++) {
        const mP = recorded[i - 1], mC = recorded[i];
        const vP = snapsByMo[mP], vC = snapsByMo[mC];
        const [y1, n1] = mP.split('-').map(Number), [y2, n2] = mC.split('-').map(Number);
        const diff = (y2 * 12 + n2) - (y1 * 12 + n1);
        let ty = y1, tm = n1;
        for (let j = 0; j < diff; j++) {
            tm++; if (tm > 12) { tm = 1; ty++; }
            const mStr = `${ty}-${String(tm).padStart(2, '0')}`;
            const isReal = realMonths.has(mStr);
            const frac = (j + 1) / diff;
            const snap = {};
            CATS.forEach(k => {
                snap[k] = Math.round(vP[k] + (vC[k] - vP[k]) * frac);
                snap[k + '_inv'] = Math.round(vP[k + '_inv'] + (vC[k + '_inv'] - vP[k + '_inv']) * frac);
            });
            all.push({ m: mStr, estimated: !isReal, ...snap });
        }
    }
    return all;
}

// Computes month-over-month deltas using last available snapshot per month.
// CASH:  value delta  → net cash flow (income, expenses, transfers)
// Other: profit delta → (val-inv) change, strips out new investments so only
//        market gain/loss is shown (e.g. +674€ new contribution in Indexa ≠ gain)
function getMonthlyDeltas(snapshots) {
    const INV_CATS = ['CRYPTO', 'FUNDS', 'ETFS'];
    return snapshots.slice(1).map((entry, i) => {
        const prev = snapshots[i];
        const delta = { m: entry.m, estimated: entry.estimated };
        // CASH: raw balance change (salary in, spending out, etc.)
        delta['CASH'] = entry['CASH'] - prev['CASH'];
        // Investment categories: only market gain, not new contributions
        INV_CATS.forEach(k => {
            const profitNow = entry[k] - (entry[k + '_inv'] || 0);
            const profitPrev = prev[k] - (prev[k + '_inv'] || 0);
            delta[k] = profitNow - profitPrev;
        });
        delta.total = ['CASH', ...INV_CATS].reduce((s, k) => s + delta[k], 0);
        return delta;
    });
}

// Applies tRange filter (respects current time pill selection)
function applyMonthlyTimeFilter(deltas) {
    const caps = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
    if (tRange === 'ALL') return deltas; // show all real user data, no arbitrary cap
    const n = caps[tRange] || deltas.length;
    return deltas.slice(-n);
}

function renderMonthly(cid = 'monthlyChart') {
    const snapshots = getMonthlySnapshots(); if (!snapshots.length) return;
    let allDeltas = getMonthlyDeltas(snapshots);
    if (!allDeltas.length) return;
    // Trim leading months where no portfolio activity has started yet (all zeros)
    const CATS = ['CASH', 'CRYPTO', 'FUNDS', 'ETFS'];
    const firstActive = allDeltas.findIndex(d => CATS.some(k => Math.abs(d[k] || 0) > 0.5));
    if (firstActive > 0) allDeltas = allDeltas.slice(firstActive);
    const filtered = applyMonthlyTimeFilter(allDeltas);

    const active = ['CASH', 'CRYPTO', 'FUNDS', 'ETFS'].filter(k => activePorts.has(k));
    const vals = filtered.map(d => active.reduce((s, k) => s + (d[k] || 0), 0));

    const bgColor = filtered.map((d, i) => {
        const v = vals[i];
        if (d.estimated) return v >= 0 ? 'rgba(21,128,61,.22)' : 'rgba(220,38,38,.22)';
        return v >= 0 ? 'rgba(21,128,61,.65)' : 'rgba(220,38,38,.65)';
    });
    const bdColor = filtered.map((d, i) => {
        const v = vals[i];
        if (!d.estimated) return 'transparent';
        return v >= 0 ? 'rgba(21,128,61,.6)' : 'rgba(220,38,38,.6)';
    });
    const lbls = filtered.map(d => {
        const [y, n] = d.m.split('-');
        const base = new Date(+y, +n - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
        return d.estimated ? `~${base}` : base;
    });

    const ctx = document.getElementById(cid)?.getContext('2d'); if (!ctx) return;
    if (charts[cid]) charts[cid].destroy();
    charts[cid] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: lbls,
            datasets: [{
                data: vals,
                backgroundColor: bgColor,
                borderColor: bdColor,
                borderWidth: filtered.map(d => d.estimated ? 1.5 : 0),
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0E0D0B',
                    callbacks: {
                        title: items => {
                            const d = filtered[items[0].dataIndex];
                            return d.estimated ? `${items[0].label.replace('~','')} (estimado)` : items[0].label;
                        },
                        label: c => ` ${c.parsed.y >= 0 ? '+' : ''}${eur(c.parsed.y)}`
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, maxRotation: 40, autoSkip: false } },
                y: { grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, callback: v => eur(v) } }
            }
        }
    });

    // Table always capped at 12 months regardless of chart range
    renderMonthlyTable(filtered.slice(-12));
}

function renderMonthlyTable(filtered) {
    const wrap = document.getElementById('monthly-table-wrap');
    const thead = document.getElementById('monthly-heat-head');
    const tbody = document.getElementById('monthly-heat-tbody');
    if (!wrap || !thead || !tbody) return;

    const active = ['CASH', 'CRYPTO', 'FUNDS', 'ETFS'].filter(k => activePorts.has(k));
    if (active.length === 0 || filtered.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';

    const catLabels = { CASH: 'Efectivo', CRYPTO: 'Crypto', FUNDS: 'Fondos', ETFS: 'ETFs' };

    // Header: Category names
    thead.innerHTML = `<tr>
        <th style="min-width:70px">Mes</th>
        ${active.map(k => `<th>${catLabels[k]}</th>`).join('')}
        <th class="mh-total">Total</th>
    </tr>`;

    function cell(v, extra = '') {
        if (v === 0) return `<td class="mh-cell-zero ${extra}">—</td>`;
        const cls = v > 0 ? 'mh-cell-pos' : 'mh-cell-neg';
        return `<td class="${cls} ${extra}">${v > 0 ? '+' : ''}${eur(v)}</td>`;
    }

    tbody.innerHTML = filtered.map(d => {
        const [y, n] = d.m.split('-');
        const lbl = new Date(+y, +n - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
        const activeTotal = active.reduce((s, k) => s + (d[k] || 0), 0);
        const estClass = d.estimated ? 'estimated' : '';
        const monthLabel = d.estimated ? `~${lbl}` : lbl;
        return `<tr class="${estClass}">
            <td>${monthLabel}</td>
            ${active.map(k => cell(d[k] || 0)).join('')}
            ${cell(activeTotal, 'mh-total ' + (activeTotal > 0 ? 'mh-tot-pos' : activeTotal < 0 ? 'mh-tot-neg' : ''))}
        </tr>`;
    }).reverse().join(''); // Most recent first
}

function renderAssetPerformers() {
    const el = document.getElementById('asset-performers'); if (!el) return;
    const g = DATA.portfolios_grouped;
    const allAssets = [];
    Object.entries(g).forEach(([type, gr]) => {
        gr.assets.forEach(a => {
            if (a.portfolio !== 'CASH' && a.invested > 0) {
                allAssets.push({ ...a, type });
            }
        });
    });
    // Sort by twr (already correctly computed per-asset, Indexa uses profit_loss_pct)
    allAssets.sort((a, b) => b.twr - a.twr);

    if (!allAssets.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-3);text-align:center;padding:16px;">Sin activos de mercado para rankear.</div>'; return; }

    el.innerHTML = allAssets.map((a, i) => {
        const twrPct = a.twr || 0;
        const isTop = i < 3, isBot = i >= allAssets.length - 2;
        const rankClass = isTop ? 'top' : isBot ? 'bot' : '';
        const pctClass = twrPct >= 0 ? 'color:var(--green)' : 'color:var(--red)';
        const typeColors = { ETFS: '#059669', FUNDS: '#0891B2', CRYPTO: '#7C3AED', CASH: '#6B7280' };
        return `<div class="perf-row">
            <div class="perf-rank ${rankClass}">${i + 1}</div>
            <div class="perf-name" title="${a.name}">${a.name}</div>
            <div class="perf-type" style="color:${typeColors[a.portfolio] || 'var(--text-3)'}">${a.portfolio}</div>
            <div class="perf-amt">${a.profit >= 0 ? '+' : ''}${eur(a.profit)}</div>
            <div class="perf-pct" style="${pctClass}">${twrPct >= 0 ? '+' : ''}${twrPct.toFixed(1)}%</div>
        </div>`;
    }).join('');
}

function renderAlloc() {
    const g = DATA.portfolios_grouped; const tot = Object.values(g).reduce((s, v) => s + v.total_val, 0);
    document.getElementById('alloc-list').innerHTML = Object.entries(g).map(([name, gr], i) => {
        const p = tot > 0 ? (gr.total_val / tot * 100) : 0, profit = gr.total_val - gr.total_inv, pp = gr.total_inv > 0 ? (profit / gr.total_inv * 100).toFixed(1) : 0, c = GRP_COLORS[i % GRP_COLORS.length];
        const profitHTML = name === 'CASH' ? '' : `<span style="font-size:11px;margin-left:6px;color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};">${profit >= 0 ? '+' : ''}${pp}%</span>`;
        const subHTML = name === 'CASH' ? `${p.toFixed(1)}% del patrimonio` : `${p.toFixed(1)}% del patrimonio · ${eur(gr.total_inv)} invertido`;
        return `<div class="alloc-item"><div class="alloc-row"><div class="alloc-name"><div style="width:8px;height:8px;border-radius:2px;background:${c}"></div>${name}</div><div><span class="alloc-right">${eur(gr.total_val)}</span>${profitHTML}</div></div><div class="alloc-bar"><div class="alloc-fill" style="width:${p.toFixed(1)}%;background:${c}"></div></div><div class="alloc-sub">${subHTML}</div></div>`;
    }).join('');
}

let sortCol = 'value', sortDir = -1; const collapsed = {};
function renderTable() {
    const g = DATA.portfolios_grouped; const tot = Object.values(g).reduce((s, v) => s + v.total_val, 0);
    const tbody = document.getElementById('tbody'); tbody.innerHTML = '';
    let colorIndex = 0;
    Object.entries(g).forEach(([name, gr]) => {
        const c = GRP_COLORS[colorIndex % GRP_COLORS.length]; colorIndex++;
        const profit = gr.total_val - gr.total_inv, isCol = !!collapsed[name], tr = document.createElement('tr');
        tr.className = 'tr-group'; tr.dataset.g = name;
        const groupProfitHTML = name === 'CASH' ? '' : `<span class="gval ${profit >= 0 ? 'up' : 'down'}">${profit >= 0 ? '+' : ''}${eur(profit)}</span>`;
        tr.innerHTML = `<td colspan="9"><div class="group-inner"><div style="width:18px;height:18px;border-radius:4px;background:${c}22;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg></div><span class="gchev ${isCol ? '' : 'open'}">▶</span><span class="gname">${name}</span><span class="gmeta">${gr.assets.length} activos · ${tot > 0 ? (gr.total_val / tot * 100).toFixed(1) : 0}%</span><div class="gright"><span class="gval">${eur(gr.total_val)}</span>${groupProfitHTML}</div></div></td>`;
        tr.addEventListener('click', () => { collapsed[name] = !collapsed[name]; const ic = collapsed[name]; tr.querySelector('.gchev').className = 'gchev ' + (ic ? '' : 'open'); document.querySelectorAll(`[data-pg="${name}"]`).forEach(r => r.style.display = ic ? 'none' : ''); });
        tbody.appendChild(tr);
        [...gr.assets].sort((a, b) => { const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0; return sortDir * (typeof av === 'string' ? av.localeCompare(bv) : av - bv); }).forEach(asset => {
            const ap = tot > 0 ? (asset.value / tot * 100) : 0, atr = document.createElement('tr');
            atr.className = 'tr-asset'; atr.dataset.pg = name; if (isCol) atr.style.display = 'none';
            const isCash = asset.portfolio === 'CASH';
            atr.innerHTML = `<td>${asset.name}</td><td class="mono" style="text-align:right">${isCash ? '-' : (asset.holdings < 1 ? asset.holdings.toFixed(4) : asset.holdings.toLocaleString('es-ES'))}</td><td class="mono" style="text-align:right">${isCash ? '-' : eur(asset.price)}</td><td class="mono" style="text-align:right">${isCash ? '-' : eur(asset.invested)}</td><td class="mono" style="text-align:right">${eur(asset.value)}</td><td class="mono ${!isCash && asset.profit >= 0 ? 'up' : 'down'}" style="text-align:right">${isCash ? '-' : (asset.profit >= 0 ? '+' : '') + eur(asset.profit)}</td><td class="mono ${!isCash && asset.twr >= 0 ? 'up' : 'down'}" style="text-align:center">${isCash ? '-' : pct(asset.twr)}</td><td class="mono ${!isCash && asset.mwr >= 0 ? 'up' : 'down'}" style="text-align:center">${isCash ? '-' : pct(asset.mwr)}</td><td><div class="mbar-wrap"><div class="mbar"><div class="mbar-fill" style="width:${Math.min(ap * 3, 100)}%;background:${c}"></div></div><span class="mpct">${ap.toFixed(1)}%</span></div></td>`;
            tbody.appendChild(atr);
        });
    });
}
function initSort() { document.querySelectorAll('th[data-col]').forEach(th => { th.addEventListener('click', () => { const col = th.dataset.col; if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = -1; } document.querySelectorAll('th').forEach(t => t.className = ''); th.className = sortDir === -1 ? 'desc' : 'asc'; renderTable(); }); }); }
function initToggles() {
    document.querySelectorAll('.ptog').forEach(el => {
        el.addEventListener('click', () => {
            const p = el.dataset.p;
            if (activePorts.has(p)) { if (activePorts.size > 1) activePorts.delete(p); } else { activePorts.add(p); }
            document.querySelectorAll(`.ptog[data-p="${p}"]`).forEach(btn => btn.classList.toggle('active', activePorts.has(p)));
            renderTrend();
            renderMonthly(); // re-renders chart + table + performers
        });
    });
}
function initPills() {
    document.querySelectorAll('.pill[data-r]').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('.pill[data-r]').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            tRange = b.dataset.r;
            renderTrend();
            renderMonthly(); // also re-render monthly chart and table with new range
        });
    });
}

// ════════════════════════════════════════════════════════════
// TRANSACTIONS
// ════════════════════════════════════════════════════════════
let txSearchTimeout;
function debouncedRenderTransactions() { clearTimeout(txSearchTimeout); txSearchTimeout = setTimeout(() => { renderTransactionsTable(); updateFilterBadge(); }, 300); }

function toggleMobileFilters() {
    const panel = document.getElementById('tx-extra-filters');
    const btn = document.getElementById('btn-filters-toggle');
    if (!panel) return;
    panel.classList.toggle('open');
    if (btn) btn.classList.toggle('active', panel.classList.contains('open'));
}

function updateFilterBadge() {
    const vals = [
        document.getElementById('filter-col-cat')?.value,
        document.getElementById('filter-col-source')?.value,
        document.getElementById('filter-col-date')?.value,
        document.getElementById('filter-col-amount')?.value,
        document.getElementById('filter-status')?.value
    ];
    const active = vals.filter(v => v && v !== '' && v !== 'ALL').length;
    const badge = document.getElementById('filter-badge');
    if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

async function fetchTransactions() {
    try { const r = await tokenFetch('/api/transactions'); ALL_TRANSACTIONS = await r.json(); renderTransactionsTable(); }
    catch (e) { console.error('Error cargando transacciones:', e); }
}

async function fetchCategoriesCache() {
    const r = await tokenFetch('/api/categories'); CATEGORIES_CACHE = await r.json();
}

async function handleFileUpload(input) {
    if (!input.files || !input.files.length) return;
    const file = input.files[0], source = document.getElementById('import-source').value;
    const formData = new FormData(); formData.append('file', file); formData.append('source', source);
    try {
        document.querySelector('[onclick*="import-file"]').textContent = 'Procesando...';
        const r = await tokenFetch('/api/transactions/import', { method: 'POST', body: formData });
        const res = await r.json();
        if (res.imported !== undefined) { alert(`¡Importados ${res.imported} movimientos.`); fetchTransactions(); }
    } catch (e) { alert('Error de conexión.'); }
    finally { document.querySelector('[onclick*="import-file"]').textContent = 'Importar'; input.value = ''; }
}

function renderTransactionsTable() {
    updateFilterBadge();
    const query = (document.getElementById('tx-search')?.value || '').toLowerCase();
    const typeF = document.getElementById('filter-type')?.value || 'ALL';
    const statusF = document.getElementById('filter-status')?.value || 'ALL';
    const colDate = (document.getElementById('filter-col-date')?.value || '').toLowerCase();
    const colSource = (document.getElementById('filter-col-source')?.value || '').toLowerCase();
    const colDesc = (document.getElementById('filter-col-desc')?.value || '').toLowerCase();
    const colAmount = (document.getElementById('filter-col-amount')?.value || '').toLowerCase();
    const colCat = (document.getElementById('filter-col-cat')?.value || '').toLowerCase();

    const filtered = ALL_TRANSACTIONS.filter(t => {
        const ms = t.description.toLowerCase().includes(query) || (t.category || '').toLowerCase().includes(query);
        const mt = typeF === 'ALL' || (typeF === 'INC' && t.amount > 0) || (typeF === 'EXP' && t.amount < 0);
        const ms2 = statusF === 'ALL' || (statusF === 'PENDING' && !t.is_reviewed) || (statusF === 'REVIEWED' && t.is_reviewed);
        const mcDate = !colDate || (t.date || '').toLowerCase().includes(colDate);
        const mcSource = !colSource || (t.source || '').toLowerCase().includes(colSource);
        const mcDesc = !colDesc || (t.description || '').toLowerCase().includes(colDesc);
        const mcAmount = !colAmount || String(t.amount).toLowerCase().includes(colAmount);
        const mcCat = !colCat || (t.category || '').toLowerCase().includes(colCat);
        return ms && mt && ms2 && mcDate && mcSource && mcDesc && mcAmount && mcCat;
    });

    const wrap = document.getElementById('tbody-transactions-wrap');
    const noData = document.getElementById('no-transactions');
    wrap.innerHTML = '';

    if (!filtered || !filtered.length) { noData.style.display = 'block'; document.getElementById('tx-count').textContent = ''; return; }
    noData.style.display = 'none';
    document.getElementById('tx-count').textContent = `Mostrando ${filtered.length} de ${ALL_TRANSACTIONS.length} movimientos`;

    const byId = {}; filtered.forEach(t => byId[t.id] = t);
    const roots = filtered.filter(t => !t.linked_transaction_id || !byId[t.linked_transaction_id]);
    const childrenByParent = {};
    filtered.forEach(t => { if (t.linked_transaction_id) { if (!childrenByParent[t.linked_transaction_id]) childrenByParent[t.linked_transaction_id] = []; childrenByParent[t.linked_transaction_id].push(t); } });

    const byMonth = {};
    roots.forEach(t => {
        const m = t.date.substring(0, 7);
        if (!byMonth[m]) byMonth[m] = [];
        byMonth[m].push({ root: t, children: childrenByParent[t.id] || [] });
    });

    const sortedMonths = Object.keys(byMonth).sort().reverse();
    sortedMonths.forEach(month => {
        const [yr, mo] = month.split('-');
        const label = new Date(+yr, +mo - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const txsInMonth = byMonth[month];
        const monthInc = txsInMonth.reduce((s, { root, children }) => { if (root.category === 'Movimientos') return s; const netAmt = root.amount + children.reduce((a, c) => a + c.amount, 0); return s + (netAmt > 0 ? netAmt : 0); }, 0);
        const monthExp = txsInMonth.reduce((s, { root, children }) => { if (root.category === 'Movimientos') return s; const netAmt = root.amount + children.reduce((a, c) => a + c.amount, 0); return s + (netAmt < 0 ? Math.abs(netAmt) : 0); }, 0);

        const mh = document.createElement('div');
        mh.className = 'tx-month-header';
        mh.innerHTML = `<span class="tx-month-label">${label}</span><div class="tx-month-stats"><span class="tx-month-stat up">+${eur(monthInc)}</span><span class="tx-month-stat down">-${eur(monthExp)}</span><span class="tx-month-stat" style="color:${monthInc - monthExp >= 0 ? 'var(--green)' : 'var(--red)'};">${monthInc - monthExp >= 0 ? '+' : ''}${eur(monthInc - monthExp)}</span></div>`;
        wrap.appendChild(mh);

        txsInMonth.forEach(({ root, children }) => {
            if (children.length > 0) wrap.appendChild(buildGroupBlock(root, children));
            else wrap.appendChild(buildTxRow(root));
        });
    });
}

function buildGroupBlock(parent, children) {
    const totalAmount = parent.amount + children.reduce((s, c) => s + c.amount, 0);
    const amtClass = parent.category === 'Movimientos' ? 'neutral-amount' : (totalAmount >= 0 ? 'up' : 'down');
    const block = document.createElement('div'); block.className = 'tx-group-block'; const gid = `grp-${parent.id}`;

    const header = document.createElement('div'); header.className = 'tx-group-header'; header.dataset.toggleGroup = gid;
    header.innerHTML = `<div class="tx-group-chevron" id="chev-${gid}">▶</div><span class="tx-group-sum">Σ</span><span class="tx-group-desc" style="display:flex;align-items:center;gap:6px">${parent.description}<button class="btn-icon-soft" onclick="event.stopPropagation(); renameTransaction('${parent.id}', '${parent.description.replace(/'/g, "\\'")}')" title="Renombrar"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button></span><span class="tx-group-badge">${children.length + 1} MOV</span><span class="tx-group-amount ${amtClass}" style="margin-right:12px">${eur(totalAmount)}</span><div style="position:relative;display:inline-block">${buildCatPillHTML(parent)}<div id="popover-g-${parent.id}" class="cat-popover" onclick="event.stopPropagation()" style="right:0;left:auto"></div></div><button class="btn-del" onclick="event.stopPropagation();deleteTransaction('${parent.id}')" style="opacity:.4;margin-left:8px"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>`;
    header.querySelector('.tx-group-chevron').addEventListener('click', e => { e.stopPropagation(); toggleGroupBlock(gid); });
    const catPill = header.querySelector('.cat-pill');
    if (catPill) catPill.addEventListener('click', e => { e.stopPropagation(); toggleCategoryPopover(e, parent.id, 'g-'); });
    block.appendChild(header);

    header.addEventListener('dragover', e => { e.preventDefault(); header.style.background = 'rgba(37, 99, 235, 0.08)'; header.style.outline = '2px dashed var(--accent)'; header.style.outlineOffset = '-2px'; });
    header.addEventListener('dragleave', () => { header.style.background = ''; header.style.outline = ''; });
    header.addEventListener('drop', e => { e.preventDefault(); header.style.background = ''; header.style.outline = ''; const cid = e.dataTransfer.getData('text/plain'); if (cid && cid != String(parent.id)) linkTransactions(cid, parent.id); });

    const body = document.createElement('div'); body.className = 'tx-group-body'; body.id = gid;
    body.appendChild(buildGroupChildRow(parent, true));
    children.forEach(c => body.appendChild(buildGroupChildRow(c, false)));
    block.appendChild(body);
    return block;
}

function buildGroupChildRow(t, isParent) {
    const row = document.createElement('div'); row.className = 'tx-group-child'; row.setAttribute('draggable', 'true'); row.dataset.id = t.id;
    const amtClass = t.category === 'Movimientos' ? 'neutral-amount' : (t.amount >= 0 ? 'up' : 'down');
    row.innerHTML = `<div class="tx-date-col" style="padding-left:0">${t.date}</div><div class="tx-source-col" title="${BANK_CONFIG[t.source]?.label||t.source}" style="display:flex;align-items:center;gap:5px;">${bankLogo(t.source,18)}<span style="font-size:10px;font-weight:600;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${BANK_CONFIG[t.source]?.label||t.source}</span></div><div class="tx-desc-col"><div class="tx-desc-main" style="display:inline-flex;align-items:center;gap:6px"><span class="tx-desc-text">${t.description}</span><button class="btn-icon-soft" onclick="event.stopPropagation(); renameTransaction('${t.id}', '${t.description.replace(/'/g, "\\'")}')" title="Renombrar"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button></div></div><div class="tx-amount-col ${amtClass}" style="opacity:0.8">${eur(t.amount)}</div><div class="tx-cat-col" style="position:relative">${buildCatPillHTML(t)}<div id="popover-${t.id}" class="cat-popover" onclick="event.stopPropagation()"></div></div><div class="tx-status-col"><span class="${t.is_reviewed ? 'status-ok' : 'status-ia'}" onclick="toggleReviewed('${t.id}',${!t.is_reviewed})">${t.is_reviewed ? '✓ OK' : 'IA'}</span></div><div class="tx-actions-col" style="gap:4px"><button class="btn-icon-soft" style="opacity:0.4;color:var(--crypto)" onclick="openSubModal('${t.id}', '${t.description.replace(/'/g, "\\'")}', ${Math.abs(t.amount)})" title="Marcar como Suscripción"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>${t.linked_transaction_id ? `<button class="btn-del" onclick="unlinkTransaction('${t.id}')" title="Desvincular" style="opacity:0.4;color:var(--accent)"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>` : ''}<button class="btn-del" onclick="deleteTransaction('${t.id}')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></div>`;
    const catPill = row.querySelector('.cat-pill'); if (catPill) catPill.addEventListener('click', e => { e.stopPropagation(); toggleCategoryPopover(e, t.id); });
    row.addEventListener('dragstart', e => { draggedTransactionId = t.id; row.style.opacity = '.4'; e.dataTransfer.setData('text/plain', t.id); if (t.linked_transaction_id) document.getElementById('unlink-zone').classList.add('visible'); });
    row.addEventListener('dragend', () => { row.style.opacity = '1'; document.getElementById('unlink-zone').classList.remove('visible'); });
    return row;
}

function buildTxRow(t) {
    const row = document.createElement('div'); row.className = 'tx-row'; row.setAttribute('draggable', 'true'); row.dataset.id = t.id;
    const amtClass = t.category === 'Movimientos' ? 'neutral-amount' : (t.amount >= 0 ? 'up' : 'down');
    row.innerHTML = `<div class="tx-date-col">${t.date}</div><div class="tx-source-col" title="${BANK_CONFIG[t.source]?.label||t.source}" style="display:flex;align-items:center;gap:5px;">${bankLogo(t.source,20)}<span style="font-size:10px;font-weight:600;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${BANK_CONFIG[t.source]?.label||t.source}</span></div><div class="tx-desc-col"><div class="tx-desc-main" style="display:inline-flex;align-items:center;gap:6px"><span class="tx-desc-text">${t.description}</span><button class="btn-icon-soft" onclick="event.stopPropagation(); renameTransaction('${t.id}', '${t.description.replace(/'/g, "\\'")}')" title="Renombrar"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button></div>${t.subcategory ? `<div class="tx-desc-sub">${t.subcategory}</div>` : ''}</div><div class="tx-amount-col ${amtClass}">${eur(t.amount)}</div><div class="tx-cat-col" style="position:relative">${buildCatPillHTML(t)}<div id="popover-${t.id}" class="cat-popover" onclick="event.stopPropagation()"></div></div><div class="tx-status-col"><span class="${t.is_reviewed ? 'status-ok' : 'status-ia'}" onclick="toggleReviewed('${t.id}',${!t.is_reviewed})">${t.is_reviewed ? '✓ OK' : 'IA'}</span></div><div class="tx-actions-col" style="gap:4px"><button class="btn-icon-soft" style="opacity:0.4;color:var(--crypto)" onclick="openSubModal('${t.id}', '${t.description.replace(/'/g, "\\'")}', ${Math.abs(t.amount)})" title="Añadir a Suscripciones"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button><button class="btn-del" onclick="deleteTransaction('${t.id}')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></div>`;
    const catPill = row.querySelector('.cat-pill'); if (catPill) catPill.addEventListener('click', e => { e.stopPropagation(); toggleCategoryPopover(e, t.id); });
    row.addEventListener('dragstart', e => { draggedTransactionId = t.id; row.style.opacity = '.4'; e.dataTransfer.setData('text/plain', t.id); });
    row.addEventListener('dragend', () => { row.style.opacity = '1'; document.querySelectorAll('.tx-row,.tx-group-block').forEach(el => el.classList.remove('over')); document.getElementById('unlink-zone').classList.remove('visible'); });
    row.addEventListener('dragover', e => { e.preventDefault(); if (draggedTransactionId !== String(t.id)) row.style.outline = '2px dashed var(--accent)'; });
    row.addEventListener('dragleave', () => row.style.outline = '');
    row.addEventListener('drop', e => { e.preventDefault(); row.style.outline = ''; const cid = e.dataTransfer.getData('text/plain'); if (cid && cid != String(t.id)) linkTransactions(cid, t.id); });
    return row;
}

function buildCatPillHTML(t) {
    const reviewed = t.is_reviewed; const catText = t.category || (reviewed ? 'Categorizado' : 'Sin categoría');
    return `<span class="cat-pill ${reviewed ? 'reviewed' : ''}">${catText}${t.subcategory ? ` · ${t.subcategory}` : ''}</span>`;
}

function toggleGroupBlock(gid) {
    const body = document.getElementById(gid), chev = document.getElementById('chev-' + gid);
    if (!body) return; const isOpen = body.classList.toggle('open');
    chev.textContent = isOpen ? '▼' : '▶'; chev.classList.toggle('open', isOpen);
}

function toggleCategoryPopover(event, txId, prefix = '') {
    const popId = `popover-${prefix}${txId}`, popover = document.getElementById(popId);
    if (!popover) return; const isOpen = popover.classList.contains('open');
    document.querySelectorAll('.cat-popover').forEach(p => p.classList.remove('open'));
    if (!isOpen) { renderCategoryPopover(popover, txId); popover.classList.add('open'); setTimeout(() => document.addEventListener('click', function h(e) { if (!popover.contains(e.target)) { popover.classList.remove('open'); document.removeEventListener('click', h); } }, 10)); }
}

function renderCategoryPopover(container, txId) {
    container.innerHTML = `<div class="cat-pop-title">Seleccionar Categoría</div>`;
    CATEGORIES_CACHE.forEach(cat => {
        const g = document.createElement('div'); g.className = 'cat-pop-group';
        g.innerHTML = `<div class="cat-pop-group-name" style="color:${cat.color || 'var(--text-3)'}">${cat.name}</div><div class="cat-pop-subs"></div>`;
        const subWrap = g.querySelector('.cat-pop-subs');
        cat.subcategories.forEach(sub => { const btn = document.createElement('button'); btn.className = 'cat-pop-sub'; btn.textContent = sub.name; btn.onclick = () => updateTransactionCategory(txId, cat.name, sub.name, cat.id, sub.id); subWrap.appendChild(btn); });
        container.appendChild(g);
    });
}

async function updateTransactionCategory(txId, catName, subName, catId, subId) {
    await tokenFetch(`/api/transactions/${txId}`, { method: 'PATCH', body: JSON.stringify({ category: catName, category_id: catId, subcategory: subName, subcategory_id: subId, is_reviewed: true }) });
    fetchTransactions();
}
async function toggleReviewed(txId, status) { await tokenFetch(`/api/transactions/${txId}`, { method: 'PATCH', body: JSON.stringify({ is_reviewed: status }) }); fetchTransactions(); }
async function linkTransactions(childId, parentId) { await tokenFetch('/api/transactions/link', { method: 'POST', body: JSON.stringify({ child_id: childId, parent_id: parentId }) }); fetchTransactions(); }
async function unlinkTransaction(txId) { await tokenFetch('/api/transactions/unlink', { method: 'POST', body: JSON.stringify({ id: txId }) }); fetchTransactions(); }
async function renameTransaction(txId, currentName) {
    const newName = prompt('Nuevo nombre:', currentName);
    if (!newName || newName === currentName) return;
    try { await tokenFetch(`/api/transactions/${txId}`, { method: 'PATCH', body: JSON.stringify({ description: newName }) }); fetchTransactions(); } catch (e) { }
}
async function deleteTransaction(txId) {
    if (!confirm('¿Eliminar esta transacción?')) return;
    try { const r = await tokenFetch(`/api/transactions/${txId}`, { method: 'DELETE' }); if (r.ok) { fetchTransactions(); if (typeof loadFinanceData === 'function') loadFinanceData(); } } catch (e) { }
}

// ─── MANUAL TRANSACTION ─────────────────────────────────────────────────────
function openManualTxModal() {
    const dateEl = document.getElementById('manual-tx-date');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    // Populate category select from cache
    const catSel = document.getElementById('manual-tx-cat');
    if (catSel && CATEGORIES_CACHE.length) {
        catSel.innerHTML = '<option value="">Sin categoría</option>' +
            CATEGORIES_CACHE.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    }
    setManualTxType('EXP');
    document.getElementById('modal-manual-tx').classList.add('open');
}

function closeManualTxModal() {
    document.getElementById('modal-manual-tx').classList.remove('open');
    document.getElementById('manual-tx-amount').value = '';
    document.getElementById('manual-tx-desc').value = '';
}

function setManualTxType(type) {
    document.getElementById('manual-tx-type').value = type;
    const expBtn = document.getElementById('manual-type-exp');
    const incBtn = document.getElementById('manual-type-inc');
    if (expBtn && incBtn) {
        if (type === 'EXP') {
            expBtn.style.background = 'var(--red)'; expBtn.style.color = '#fff';
            incBtn.style.background = 'transparent'; incBtn.style.color = 'var(--text-3)';
        } else {
            incBtn.style.background = 'var(--green)'; incBtn.style.color = '#fff';
            expBtn.style.background = 'transparent'; expBtn.style.color = 'var(--text-3)';
        }
    }
}

async function saveManualTx() {
    const type   = document.getElementById('manual-tx-type').value;
    const absAmt = parseFloat(document.getElementById('manual-tx-amount').value);
    const desc   = document.getElementById('manual-tx-desc').value.trim();
    const date   = document.getElementById('manual-tx-date').value;
    const source = document.getElementById('manual-tx-source').value;
    const cat    = document.getElementById('manual-tx-cat').value;
    if (!desc || isNaN(absAmt) || absAmt <= 0) { alert('Introduce descripción e importe.'); return; }
    const amount = type === 'EXP' ? -absAmt : absAmt;
    try {
        const r = await tokenFetch('/api/transactions', {
            method: 'POST',
            body: JSON.stringify({ date, description: desc, amount, source, category: cat })
        });
        if (r.ok) { closeManualTxModal(); fetchTransactions(); }
        else { alert('Error al guardar la transacción.'); }
    } catch(e) { alert('Error de conexión.'); }
}

// ════════════════════════════════════════════════════════════
// FINANZAS INTELIGENCIA & SUBSCRIPCIONES
// ════════════════════════════════════════════════════════════
async function loadFinanceData() {
    try {
        const rTx = await tokenFetch('/api/transactions');
        const allTx = await rTx.json();

        const byId = {}; allTx.forEach(t => byId[t.id] = t);
        const rootTx = allTx.filter(t => !t.linked_transaction_id);
        const childrenByParent = {};
        allTx.filter(t => t.linked_transaction_id).forEach(t => {
            if (!childrenByParent[t.linked_transaction_id]) childrenByParent[t.linked_transaction_id] = [];
            childrenByParent[t.linked_transaction_id].push(t);
        });

        const effectiveAmount = t => childrenByParent[t.id] ? t.amount + childrenByParent[t.id].reduce((s, c) => s + c.amount, 0) : t.amount;
        const filtered = rootTx.filter(t => t.category !== 'Movimientos');

        // Global Scope for Advanced Chart filters
        currentFinTxs = filtered.map(t => ({ ...t, amount: effectiveAmount(t) }));
        populateCategoryFilter();

        // Stats Computation
        const statsByMonth = {};
        const recurringMap = {};
        const catData = { needs: 0, wants: 0, savings: 0 };
        const categoryTotals = {};

        currentFinTxs.forEach(t => {
            const month = t.date.substring(0, 7);
            if (!statsByMonth[month]) statsByMonth[month] = { inc: 0, exp: 0 };

            if (t.amount > 0) {
                statsByMonth[month].inc += t.amount;
            } else {
                const absAmt = Math.abs(t.amount);
                statsByMonth[month].exp += absAmt;

                const recKey = `${t.description.substring(0, 12).trim().toLowerCase()}-${Math.round(absAmt)}`;
                if (!recurringMap[recKey]) recurringMap[recKey] = { count: 0, amt: absAmt, desc: t.description };
                recurringMap[recKey].count++;

                const cat = (t.category || '').toLowerCase();
                if (['vivienda', 'alquiler', 'supermercado', 'hipoteca', 'luz', 'agua', 'gas', 'internet', 'seguros', 'salud', 'farmacia'].some(x => cat.includes(x))) catData.needs += absAmt;
                else if (['ocio', 'restaurante', 'compras', 'viajes', 'suscripciones', 'regalos', 'ropa', 'bar', 'cafe'].some(x => cat.includes(x))) catData.wants += absAmt;
                else catData.savings += absAmt;

                const catName = t.category || 'Sin categoría';
                categoryTotals[catName] = (categoryTotals[catName] || 0) + absAmt;
            }
        });

        const sortedMonths = Object.keys(statsByMonth).sort();
        if (!sortedMonths.length) return;

        const incomes = sortedMonths.map(m => statsByMonth[m].inc);
        const expenses = sortedMonths.map(m => statsByMonth[m].exp);
        const avgExp = expenses.reduce((a, b) => a + b, 0) / sortedMonths.length;
        const avgInc = incomes.reduce((a, b) => a + b, 0) / sortedMonths.length;
        const avgSave = (avgInc - avgExp);

        const lastM = sortedMonths[sortedMonths.length - 1];
        const lastBal = statsByMonth[lastM].inc - statsByMonth[lastM].exp;
        const currentAssets = DATA?.summary?.total_money || 0;
        const runway = avgExp > 0 ? (currentAssets / avgExp) : 0;
        const saveRate = avgInc > 0 ? (avgSave / avgInc * 100) : 0;

        // Render All Modules
        set('f-runway', `${runway.toFixed(1)} meses`);
        set('f-saving-rate', `${saveRate.toFixed(1)}%`);
        set('f-burn-rate', eur(-avgExp));
        set('f-last-inc', eur(statsByMonth[lastM].inc));
        set('f-last-exp', eur(-statsByMonth[lastM].exp));
        const lastBalEl = document.getElementById('f-last-balance');
        if (lastBalEl) { lastBalEl.textContent = eur(lastBal); lastBalEl.className = 'kpi-val ' + (lastBal >= 0 ? 'up' : 'down'); }
        const hs = Math.min(100, Math.round(Math.max(0, (runway / 6 * 30) + (saveRate * 1.2) + 15)));
        if (document.getElementById('finance-health-score')) document.getElementById('finance-health-score').innerHTML = `Salud Financiera: <span style="font-weight:800;font-size:16px">${hs}</span>/100`;

        // Update subscriptions summary badge
        if (SERVER_SUBSCRIPTIONS.length > 0) {
            const totalMonthly = SERVER_SUBSCRIPTIONS.reduce((s, sub) => s + toMonthly(sub), 0);
            set('f-sub-total', eur(-totalMonthly) + '/mes');
        }

        renderRule503020(catData);
        generateFinanceInsights(runway, saveRate, avgSave, lastBal);
        applyFinanceFilters();

    } catch (err) { console.error('Error cargando finanzas:', err); }
}

// --- CHART FILTERS & RENDERING ---
function populateCategoryFilter() {
    const select = document.getElementById('fin-filter-cat');
    if (!select) return;
    const cats = [...new Set(currentFinTxs.map(t => t.category).filter(Boolean))].sort();
    select.innerHTML = `<option value="ALL">Todas las Categorías</option>` + cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function applyFinanceFilters() {
    const timeF = document.getElementById('fin-filter-time')?.value || '6M';
    const typeF = document.getElementById('fin-filter-type')?.value || 'ALL';
    const catF = document.getElementById('fin-filter-cat')?.value || 'ALL';

    let filtered = currentFinTxs;

    // Filtro Temporal para todo (Gráfico, Top Categorías e Ingresos)
    if (timeF !== 'ALL') {
        const months = parseInt(timeF.replace('M', ''));
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
        const cutoffStr = cutoff.toISOString().substring(0, 7);
        filtered = filtered.filter(t => t.date.substring(0, 7) >= cutoffStr);
    }

    // Aplicar filtro de categoría SOLO al gráfico para que el resto tenga contexto
    let chartFiltered = filtered;
    if (catF !== 'ALL') {
        chartFiltered = chartFiltered.filter(t => t.category === catF);
    }

    const stats = {};
    chartFiltered.forEach(t => {
        const m = t.date.substring(0, 7);
        if (!stats[m]) stats[m] = { inc: 0, exp: 0 };
        if (t.amount > 0) stats[m].inc += t.amount; else stats[m].exp += Math.abs(t.amount);
    });

    const lbls = Object.keys(stats).sort();
    const incs = lbls.map(m => stats[m].inc);
    const exps = lbls.map(m => stats[m].exp);
    const nets = lbls.map((m, i) => incs[i] - exps[i]);

    const ctx = document.getElementById('financeChart')?.getContext('2d');
    if (ctx) {
        const gGreen = ctx.createLinearGradient(0, 0, 0, 320);
        gGreen.addColorStop(0, 'rgba(16,185,129,0.22)'); gGreen.addColorStop(1, 'rgba(16,185,129,0)');
        const gRed = ctx.createLinearGradient(0, 0, 0, 320);
        gRed.addColorStop(0, 'rgba(239,68,68,0.18)'); gRed.addColorStop(1, 'rgba(239,68,68,0)');
        const gBlue = ctx.createLinearGradient(0, 0, 0, 320);
        gBlue.addColorStop(0, 'rgba(37,99,235,0.15)'); gBlue.addColorStop(1, 'rgba(37,99,235,0)');

        const ds = [];
        if (typeF === 'ALL' || typeF === 'INC') ds.push({
            label: 'Ingresos', data: incs, borderColor: '#10B981', backgroundColor: gGreen,
            borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#10B981', pointBorderWidth: 0,
            tension: 0.4, fill: true
        });
        if (typeF === 'ALL' || typeF === 'EXP') ds.push({
            label: 'Gastos', data: exps, borderColor: '#EF4444', backgroundColor: gRed,
            borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#EF4444', pointBorderWidth: 0,
            tension: 0.4, fill: true
        });
        if (typeF === 'ALL' || typeF === 'NET') ds.push({
            label: 'Ahorro Neto', data: nets, borderColor: '#2563EB', backgroundColor: gBlue,
            borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#2563EB', pointBorderWidth: 2,
            tension: 0.4, fill: true
        });

        if (financeChart) financeChart.destroy();
        financeChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: lbls.map(m => { const [y, n] = m.split('-'); return new Date(+y, +n-1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }); }),
                datasets: ds
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', align: 'end', labels: { usePointStyle: true, pointStyleWidth: 8, boxHeight: 6, font: { size: 11, family: 'DM Sans' }, color: 'rgba(100,100,120,0.85)', padding: 16 } },
                    tooltip: { backgroundColor: 'rgba(15,15,30,0.85)', padding: 12, cornerRadius: 8, titleFont: { size: 12, weight: '600' }, bodyFont: { size: 12 }, callbacks: { label: c => ` ${c.dataset.label}: ${eur(c.raw)}` } }
                },
                scales: {
                    y: { ticks: { callback: v => eur(v), font: { size: 11 }, maxTicksLimit: 5, color: 'rgba(100,100,120,0.7)' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
                    x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 11 }, color: 'rgba(100,100,120,0.7)' } }
                }
            }
        });
    }

    // Rebuild month pills from the time-filtered set, then render breakdowns
    renderBreakdownMonthFilter(filtered);
    renderBreakdowns(filtered);
}

// Populate month pills from the currently time-filtered transactions
function renderBreakdownMonthFilter(txs) {
    const container = document.getElementById('breakdown-month-pills');
    if (!container) return;
    const months = [...new Set(txs.map(t => t.date.substring(0, 7)))].sort().reverse();

    const pills = [{ value: 'ALL', label: 'Todo el período' }, ...months.map(m => {
        const [y, n] = m.split('-');
        return { value: m, label: new Date(+y, +n - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }) };
    })];

    // If currently selected month is no longer in the filtered set, reset
    if (selectedBreakdownMonth !== 'ALL' && !months.includes(selectedBreakdownMonth)) {
        selectedBreakdownMonth = 'ALL';
    }

    container.innerHTML = pills.map(p => `
        <button onclick="selectBreakdownMonth('${p.value}')"
            style="padding:4px 10px;border-radius:6px;border:1px solid ${p.value === selectedBreakdownMonth ? 'var(--accent)' : 'var(--border)'};
            background:${p.value === selectedBreakdownMonth ? 'var(--accent)' : 'var(--surface)'};
            color:${p.value === selectedBreakdownMonth ? '#fff' : 'var(--text-2)'};
            font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;">
            ${p.label}
        </button>`).join('');
}

function selectBreakdownMonth(month) {
    selectedBreakdownMonth = month;
    // Re-render without rebuilding pills (just re-apply current filter set)
    const timeF = document.getElementById('fin-filter-time')?.value || '6M';
    let base = currentFinTxs;
    if (timeF !== 'ALL') {
        const mo = parseInt(timeF.replace('M', ''));
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - mo);
        const cutoffStr = cutoff.toISOString().substring(0, 7);
        base = base.filter(t => t.date.substring(0, 7) >= cutoffStr);
    }
    renderBreakdownMonthFilter(base);
    renderBreakdowns(base);
}

function renderBreakdowns(timePeriodTxs) {
    const filtered = selectedBreakdownMonth === 'ALL'
        ? timePeriodTxs
        : timePeriodTxs.filter(t => t.date.substring(0, 7) === selectedBreakdownMonth);

    renderIncomesBreakdown(filtered);

    // Build catTotals + color map BEFORE subcategory render (colors needed by subcats)
    const CAT_COLORS_ORDERED = ['#2563EB','#7C3AED','#0891B2','#059669','#D97706','#DC2626','#6B7280','#0E7490'];
    const catTotals = {};
    let expTotal = 0;
    filtered.forEach(t => {
        if (t.amount < 0) {
            const catName = t.category || 'Sin categoría';
            catTotals[catName] = (catTotals[catName] || 0) + Math.abs(t.amount);
            expTotal += Math.abs(t.amount);
        }
    });
    const expEl = document.getElementById('f-expense-total');
    if (expEl) expEl.textContent = expTotal > 0 ? eur(expTotal) : '—';

    expenseCatColorMap = {};
    Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .forEach(([name], i) => { expenseCatColorMap[name] = CAT_COLORS_ORDERED[i]; });

    // Remove selected cats no longer in this period's data
    selectedExpenseCategories.forEach(cat => {
        if (!expenseCatColorMap[cat]) selectedExpenseCategories.delete(cat);
    });

    renderSubcategoryBreakdown(filtered);
    renderTopCategories(catTotals);
}

// --- INCOMES BREAKDOWN ---
const INCOME_SOURCES = [
    { key: 'nomina', label: 'Nómina / Salario', icon: '💼', color: '#15803D', bg: 'rgba(21,128,61,0.1)',
      patterns: ['nomina','nómina','sueldo','salario','payroll','mensualidad empresa','retribucion'] },
    { key: 'dividendo', label: 'Dividendos', icon: '📈', color: '#0891B2', bg: 'rgba(8,145,178,0.1)',
      patterns: ['dividendo','dividend','reparto'] },
    { key: 'freelance', label: 'Freelance / Honorarios', icon: '🖥️', color: '#7C3AED', bg: 'rgba(124,58,237,0.1)',
      patterns: ['honorario','factura','freelance','cliente','prestacion servicio','servicio profesional'] },
    { key: 'reembolso', label: 'Reembolsos / Devoluciones', icon: '↩️', color: '#6B7280', bg: 'rgba(107,114,128,0.1)',
      patterns: ['reembolso','devolución','devolucion','refund','reintegro','compensacion'] },
    { key: 'transferencia', label: 'Transferencias Recibidas', icon: '💳', color: '#D97706', bg: 'rgba(217,119,6,0.1)',
      patterns: ['transferencia de','bizum','envio de','pago de','ingreso de'] },
    { key: 'inversion', label: 'Rendimientos de Inversión', icon: '📊', color: '#2563EB', bg: 'rgba(37,99,235,0.1)',
      patterns: ['inversion','inversión','cupon','cupón','interes','venta activo','liquidacion'] },
];

function detectIncomeSource(description, category) {
    const desc = (description || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const cat = (category || '').toLowerCase();
    for (const src of INCOME_SOURCES) {
        if (src.patterns.some(p => desc.includes(p) || cat.includes(p))) return src;
    }
    return { key: 'otros', label: category || 'Otros Ingresos', icon: '💰', color: '#A8A49C', bg: 'rgba(168,164,156,0.1)' };
}

function renderIncomesBreakdown(txs) {
    const incomeTxs = txs.filter(t => t.is_income === true || (t.amount > 0 && (t.category || '').toLowerCase().includes('ingres')));
    const usedTxs = incomeTxs.length > 0 ? incomeTxs : txs.filter(t => t.amount > 0);

    let incTotal = 0;
    const groups = {};
    usedTxs.forEach(t => {
        const key = t.subcategory || t.category || 'Otros Ingresos';
        if (!groups[key]) groups[key] = { total: 0, count: 0, months: new Set() };
        groups[key].total += t.amount;
        groups[key].count++;
        groups[key].months.add(t.date.substring(0, 7));
        incTotal += t.amount;
    });

    if (document.getElementById('f-income-total'))
        document.getElementById('f-income-total').textContent = eur(incTotal);

    const el = document.getElementById('income-breakdown-list');
    if (!el) return;

    if (charts.incomeDonut) { charts.incomeDonut.destroy(); charts.incomeDonut = null; }

    if (incTotal === 0) {
        el.innerHTML = '<p style="color:var(--text-3);font-size:12px;text-align:center;padding:16px;">No se encontraron ingresos en este periodo.</p>';
        return;
    }

    const INC_COLORS = ['#15803D','#0891B2','#7C3AED','#D97706','#2563EB','#6B7280','#059669','#DC2626'];
    const sorted = Object.entries(groups).sort((a, b) => b[1].total - a[1].total);
    const labels = sorted.map(([k]) => k);
    const values = sorted.map(([, g]) => g.total);
    const colors = sorted.map((_, i) => INC_COLORS[i % INC_COLORS.length]);

    const canvas = document.getElementById('incomeDonutChart');
    if (canvas) {
        const surfaceColor = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#1a1a2e';
        charts.incomeDonut = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{ data: values, backgroundColor: colors, borderWidth: 3, borderColor: surfaceColor, hoverOffset: 6 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${eur(ctx.parsed)} (${(ctx.parsed / incTotal * 100).toFixed(1)}%)` } }
                }
            },
            plugins: [{
                id: 'centerLabel',
                afterDraw(chart) {
                    const { ctx, chartArea: { left, top, width, height } } = chart;
                    const cx = left + width / 2, cy = top + height / 2;
                    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
                    const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim();
                    ctx.save();
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.font = `700 13px 'JetBrains Mono', monospace`;
                    ctx.fillStyle = textColor;
                    ctx.fillText(eur(incTotal), cx, cy - 7);
                    ctx.font = `500 9px 'DM Sans', sans-serif`;
                    ctx.fillStyle = mutedColor;
                    ctx.fillText('INGRESOS', cx, cy + 8);
                    ctx.restore();
                }
            }]
        });
    }

    // Compact legend
    el.innerHTML = sorted.map(([label, { total, months: m }], i) => {
        const p = (total / incTotal * 100).toFixed(1);
        const avgMonth = m.size > 0 ? total / m.size : total;
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
            <div style="width:8px;height:8px;border-radius:50%;background:${colors[i]};flex-shrink:0;"></div>
            <div style="flex:1;min-width:0;font-size:11.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--green);">+${eur(total)}</div>
            <div style="font-size:10px;color:var(--text-3);min-width:30px;text-align:right;">${p}%</div>
        </div>`;
    }).join('');
}

function renderSubcategoryBreakdown(txs) {
    currentBreakdownTxs = txs;
    const el = document.getElementById('top-subcats-list');
    if (!el) return;

    const hasFilter = selectedExpenseCategories.size > 0;
    let expTxs = txs.filter(t => t.amount < 0 && (t.category || '').toLowerCase() !== 'movimientos');
    if (hasFilter) expTxs = expTxs.filter(t => selectedExpenseCategories.has(t.category));

    if (!expTxs.length) { el.innerHTML = '<p style="color:var(--text-3);font-size:12px;text-align:center;padding:16px;">Sin datos de gasto.</p>'; return; }

    const groups = {};
    expTxs.forEach(t => {
        const key = t.subcategory || 'Sin subcategoría';
        const parent = t.category || '';
        if (!groups[key]) groups[key] = { label: key, parent, total: 0, count: 0 };
        groups[key].total += Math.abs(t.amount);
        groups[key].count++;
    });

    const totalExp = expTxs.reduce((s, t) => s + Math.abs(t.amount), 0);
    const sorted = Object.values(groups).sort((a, b) => b.total - a.total).slice(0, hasFilter ? 16 : 8);
    const max = sorted[0]?.total || 1;

    const filterLabel = hasFilter ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="font-size:10px;font-weight:700;color:var(--text-3);">Filtrando:</span>
        ${[...selectedExpenseCategories].map(c => `<span style="padding:2px 8px;border-radius:100px;background:${(expenseCatColorMap[c]||'#6B7280')}28;color:${expenseCatColorMap[c]||'#6B7280'};font-size:9px;font-weight:700;">${c}</span>`).join('')}
        <button onclick="clearExpenseCatFilter()" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:10px;color:var(--text-3);text-decoration:underline;padding:0;">Limpiar</button>
    </div>` : '';

    el.innerHTML = filterLabel + sorted.map(({ label, parent, total, count }) => {
        const p = (total / totalExp * 100).toFixed(0);
        const barW = (total / max * 100).toFixed(0);
        const color = expenseCatColorMap[parent] || '#6B7280';
        return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);">
            <div style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
                ${parent ? `<div style="font-size:10px;color:var(--text-3);margin-top:1px;">${parent} · ${count} mov</div>` : ''}
            </div>
            <div style="width:60px;height:4px;background:var(--bg2);border-radius:100px;overflow:hidden;flex-shrink:0;">
                <div style="height:100%;width:${barW}%;background:${color};border-radius:100px;"></div>
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:11.5px;font-weight:700;color:var(--red);flex-shrink:0;min-width:70px;text-align:right;">${eur(-total)}</div>
            <div style="font-size:10px;color:var(--text-3);flex-shrink:0;min-width:28px;text-align:right;">${p}%</div>
        </div>`;
    }).join('');
}

// --- COSTES FIJOS ---
const COST_CATEGORIES = {
    'Digital':        { icon: '📱', bg: 'rgba(37,99,235,0.1)' },
    'Salud':          { icon: '🏥', bg: 'rgba(21,128,61,0.1)' },
    'Hogar':          { icon: '🏠', bg: 'rgba(8,145,178,0.1)' },
    'Ocio':           { icon: '🎮', bg: 'rgba(124,58,237,0.1)' },
    'Productividad':  { icon: '💼', bg: 'rgba(234,88,12,0.1)' },
    'Alimentacion':   { icon: '🍎', bg: 'rgba(217,119,6,0.1)' },
    'Transporte':     { icon: '🚗', bg: 'rgba(107,114,128,0.1)' },
    'Educacion':      { icon: '📚', bg: 'rgba(79,70,229,0.1)' },
    'Profesional':    { icon: '🧠', bg: 'rgba(168,85,247,0.1)' },
    'Otro':           { icon: '📦', bg: 'rgba(168,164,156,0.1)' },
};

function closeCostModal() { document.getElementById('modal-cost-manager').classList.remove('open'); }

function openCostModal(existingId) {
    document.getElementById('cost-form-id').value = existingId || '';
    document.getElementById('cost-form-name').value = '';
    document.getElementById('cost-form-amt').value = '';
    document.getElementById('cost-form-freq').value = 'mensual';
    document.getElementById('cost-form-cat').value = 'Digital';
    document.getElementById('cost-form-day').value = '';
    document.getElementById('cost-form-times').value = '2';
    document.getElementById('times-per-month-group').style.display = 'none';
    document.getElementById('modal-cost-manager').classList.add('open');
}

function inlineRenameCost(id) {
    const s = SERVER_SUBSCRIPTIONS.find(x => x.id === id);
    if (!s) return;
    const nameEl = document.getElementById(`cost-name-${id}`);
    if (!nameEl) return;
    const prev = nameEl.textContent;
    nameEl.innerHTML = `<input type="text" value="${prev.replace(/"/g,'&quot;')}"
        style="font-size:13px;font-weight:600;border:1px solid var(--accent);border-radius:5px;padding:2px 6px;width:100%;outline:none;font-family:inherit;"
        id="cost-rename-input-${id}" onblur="commitRename('${id}')" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){document.getElementById('cost-name-${id}').textContent='${prev.replace(/'/g,'\\\'')}';}">`;
    document.getElementById(`cost-rename-input-${id}`)?.focus();
    document.getElementById(`cost-rename-input-${id}`)?.select();
}

async function commitRename(id) {
    const input = document.getElementById(`cost-rename-input-${id}`);
    if (!input) return;
    const newName = input.value.trim();
    const nameEl = document.getElementById(`cost-name-${id}`);
    if (!newName) { if (nameEl) { const s = SERVER_SUBSCRIPTIONS.find(x => x.id === id); nameEl.textContent = s?.name || ''; } return; }
    if (nameEl) nameEl.textContent = newName;
    // Persist: PATCH only the name field
    const s = SERVER_SUBSCRIPTIONS.find(x => x.id === id);
    if (s && newName !== s.name) {
        s.name = newName;  // update local cache immediately
        try {
            await tokenFetch(`/api/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
        } catch (e) { console.error('Rename failed', e); }
    }
}

function editFixedCost(id) {
    const s = SERVER_SUBSCRIPTIONS.find(x => x.id === id);
    if (!s) return;
    document.getElementById('cost-form-id').value = s.id;
    document.getElementById('cost-form-name').value = s.name || '';
    document.getElementById('cost-form-amt').value = s.amount || '';
    document.getElementById('cost-form-freq').value = s.frequency || 'mensual';
    document.getElementById('cost-form-cat').value = s.category || 'Digital';
    document.getElementById('cost-form-day').value = s.dayOfMonth || '';
    document.getElementById('cost-form-times').value = s.timesPerMonth || '2';
    document.getElementById('times-per-month-group').style.display = s.frequency === 'irregular' ? 'block' : 'none';
    document.getElementById('modal-cost-manager').classList.add('open');
}

function onFreqChange() {
    const freq = document.getElementById('cost-form-freq').value;
    document.getElementById('times-per-month-group').style.display = freq === 'irregular' ? 'block' : 'none';
}

// Keep old openSubModal alias pointing to the new modal for backward compat (transaction row buttons)
function openSubModal(txId, name, amount) {
    openCostModal();
    if (name) document.getElementById('cost-form-name').value = name;
    if (amount) document.getElementById('cost-form-amt').value = amount;
}

async function saveFixedCost() {
    const id = document.getElementById('cost-form-id').value;
    const day = document.getElementById('cost-form-day').value;
    const freq = document.getElementById('cost-form-freq').value;
    const data = {
        id: id || null,
        name: document.getElementById('cost-form-name').value,
        amount: parseFloat(document.getElementById('cost-form-amt').value),
        category: document.getElementById('cost-form-cat').value,
        frequency: freq,
        dayOfMonth: day ? parseInt(day) : null,
        timesPerMonth: freq === 'irregular' ? parseInt(document.getElementById('cost-form-times').value) : null,
    };
    if (!data.name || isNaN(data.amount)) return;
    await tokenFetch('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) });
    document.getElementById('modal-cost-manager').classList.remove('open');
    loadSubscriptionsData();
}

// Keep old alias
async function saveManualSubscription() { saveFixedCost(); }

// ════════════════════════════════════════════════════════════
// SUSCRIPCIONES PAGE
// ════════════════════════════════════════════════════════════
async function loadSubscriptionsData() {
    try {
        const [rSub, rTx] = await Promise.all([
            tokenFetch('/api/subscriptions'),
            tokenFetch('/api/transactions')
        ]);
        SERVER_SUBSCRIPTIONS = rSub.ok ? await rSub.json() : [];
        const allTx = rTx.ok ? await rTx.json() : [];

        // Avg monthly income
        const incByMonth = {};
        allTx.filter(t => t.amount > 0 && t.category !== 'Movimientos').forEach(t => {
            const m = t.date.substring(0, 7);
            incByMonth[m] = (incByMonth[m] || 0) + t.amount;
        });
        const incMonths = Object.keys(incByMonth);
        const avgIncome = incMonths.length > 0
            ? Object.values(incByMonth).reduce((a, b) => a + b, 0) / incMonths.length : 0;

        // AI subscription detection from transactions
        const recurringMap = {};
        const hiddenSubs = JSON.parse(localStorage.getItem('hidden_subs') || '[]');
        const manualSigs = SERVER_SUBSCRIPTIONS.map(s => s.name.substring(0, 12).toLowerCase());
        allTx.filter(t => t.amount < 0).forEach(t => {
            const absAmt = Math.abs(t.amount);
            const key = `${t.description.substring(0, 12).trim().toLowerCase()}-${Math.round(absAmt)}`;
            if (!recurringMap[key]) recurringMap[key] = { count: 0, amt: absAmt, desc: t.description };
            recurringMap[key].count++;
        });
        const aiSubs = Object.values(recurringMap).filter(v => v.count >= 2).filter(ai => {
            const sig = ai.desc.substring(0, 12).toLowerCase();
            return !hiddenSubs.includes(sig) && !manualSigs.some(m => sig.includes(m) || m.includes(sig));
        }).sort((a, b) => b.amt - a.amt);

        renderSubscriptionsPage(SERVER_SUBSCRIPTIONS, aiSubs, avgIncome);

        // Update the badge in finanzas page
        if (SERVER_SUBSCRIPTIONS.length > 0) {
            const totalMonthly = SERVER_SUBSCRIPTIONS.reduce((s, sub) => s + toMonthly(sub), 0);
            set('f-sub-total', eur(-totalMonthly) + '/mes');
        }
    } catch(e) { console.error('Error cargando suscripciones:', e); }
}

function renderSubscriptionsPage(manual, ai, avgIncome) {
    const withDay  = manual.filter(s => s.dayOfMonth);
    const noDay    = manual.filter(s => !s.dayOfMonth);
    const totalMonthly = manual.reduce((sum, s) => sum + toMonthly(s), 0);
    const totalAnnual  = totalMonthly * 12;

    // KPI cards
    set('sub-kpi-monthly', totalMonthly > 0 ? eur(-totalMonthly) : '—');
    set('sub-kpi-annual',  totalAnnual  > 0 ? eur(-totalAnnual)  : '—');
    set('sub-kpi-count',   String(manual.length));
    set('sub-kpi-count-foot', manual.length === 1 ? 'activa registrada' : 'activas registradas');
    const pct = avgIncome > 0 ? (totalMonthly / avgIncome * 100).toFixed(1) + '%' : '—';
    set('sub-kpi-pct', pct);

    // Burden bar
    const burdenWrap = document.getElementById('sub-burden-wrap');
    if (burdenWrap) {
        if (totalMonthly > 0 && avgIncome > 0) {
            const burdPct = Math.min(100, (totalMonthly / avgIncome * 100));
            burdenWrap.style.display = 'block';
            document.getElementById('sub-burden-bar').style.width = burdPct.toFixed(1) + '%';
            document.getElementById('sub-burden-pct').textContent = `${burdPct.toFixed(1)}% de tus ingresos medios`;
            document.getElementById('sub-burden-total').textContent = eur(-totalMonthly) + '/mes en costes fijos';
        } else {
            burdenWrap.style.display = 'none';
        }
    }

    // Calendar
    const calSection = document.getElementById('sub-cal-section');
    const cal = document.getElementById('sub-cal-grid');
    const calEmpty = document.getElementById('sub-cal-empty');
    if (cal && withDay.length > 0) {
        if (calSection) calSection.style.display = 'block';
        if (calEmpty) calEmpty.style.display = 'none';
        const now = new Date(), year = now.getFullYear(), month = now.getMonth(), today = now.getDate();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDow = new Date(year, month, 1).getDay();
        const offset = (firstDow + 6) % 7;
        const dayHeaders = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
        let html = dayHeaders.map(d => `<div style="text-align:center;font-size:10px;font-weight:700;color:var(--text-3);padding:4px 0;">${d}</div>`).join('');
        for (let i = 0; i < offset; i++) html += `<div class="cal-day" style="opacity:0;pointer-events:none;"></div>`;
        for (let d = 1; d <= daysInMonth; d++) {
            const onDay = withDay.filter(s => s.dayOfMonth == d);
            const has = onDay.length > 0, isToday = d === today;
            const todayCls = isToday ? ' cal-today' : '';
            if (has) {
                const rawName = onDay[0].name.replace(/^compra\s+/i,'').replace(/^paypal\s*\*/i,'').split(/[,\s]+/)[0];
                const dispName = rawName.length > 7 ? rawName.substring(0, 6) + '…' : rawName;
                const tooltip = onDay.map(s => s.name).join(', ');
                html += `<div class="cal-day has-cost${todayCls}" title="${tooltip}" onclick="editFixedCost('${onDay[0].id}')"><span class="cal-day-num">${d}</span><span class="cal-day-name">${dispName}</span></div>`;
            } else {
                html += `<div class="cal-day${todayCls}"><span class="cal-day-num">${d}</span></div>`;
            }
        }
        cal.innerHTML = html;
    } else if (calSection) {
        calSection.style.display = 'none';
        if (calEmpty) calEmpty.style.display = 'block';
    }

    // Upcoming charges (remaining days this month)
    const upcomingEl = document.getElementById('sub-upcoming-list');
    if (upcomingEl) {
        const now2 = new Date(), today2 = now2.getDate();
        const remaining = withDay.filter(s => s.dayOfMonth >= today2).sort((a, b) => a.dayOfMonth - b.dayOfMonth);
        // Add next-month ones if fewer than 4 remaining
        const fromNextMonth = withDay.filter(s => s.dayOfMonth < today2).sort((a, b) => a.dayOfMonth - b.dayOfMonth);
        const combined = [...remaining, ...fromNextMonth].slice(0, 6);
        if (combined.length === 0) {
            upcomingEl.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text-3);font-size:12px;">Sin cobros próximos con fecha fija</div>';
        } else {
            upcomingEl.innerHTML = combined.map(s => {
                const isRemaining = s.dayOfMonth >= today2;
                const isToday2 = s.dayOfMonth === today2;
                const monthLabel = isRemaining ? '' : '(mes que viene)';
                const cat2 = COST_CATEGORIES[s.category] || COST_CATEGORIES['Otro'];
                return `<div class="sub-upcoming-item">
                    <div class="sub-upcoming-day${isToday2 ? ' sub-upcoming-today' : ''}">
                        <span class="sub-upcoming-day-num">${s.dayOfMonth}</span>
                    </div>
                    <div class="sub-upcoming-info">
                        <div class="sub-upcoming-name">${s.name}</div>
                        <div class="sub-upcoming-meta">${cat2.icon} ${s.category || 'Otro'} ${monthLabel}</div>
                    </div>
                    <div class="sub-upcoming-amt">${eur(-toMonthly(s))}/mes</div>
                </div>`;
            }).join('');
        }
    }

    // Category breakdown
    const catEl = document.getElementById('sub-cat-list');
    if (catEl && manual.length > 0) {
        const catTotals = {};
        manual.forEach(s => {
            const cat = s.category || 'Otro';
            catTotals[cat] = (catTotals[cat] || 0) + toMonthly(s);
        });
        const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
        const maxCat = sorted[0]?.[1] || 1;
        catEl.innerHTML = sorted.map(([cat, amt]) => {
            const info = COST_CATEGORIES[cat] || COST_CATEGORIES['Otro'];
            const barW = (amt / maxCat * 100).toFixed(0);
            return `<div class="sub-cat-row">
                <div class="sub-cat-icon" style="background:${info.bg}">${info.icon}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;">${cat}</div>
                    <div class="sub-cat-bar-wrap"><div class="sub-cat-bar" style="width:${barW}%;background:var(--crypto)"></div></div>
                </div>
                <div class="sub-cat-amt">${eur(-amt)}/mes</div>
            </div>`;
        }).join('');
    } else if (catEl) {
        catEl.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text-3);font-size:12px;">Sin datos</div>';
    }

    // Items
    function buildCostItem(s) {
        const cat = COST_CATEGORIES[s.category] || COST_CATEGORIES['Otro'];
        const monthly = toMonthly(s);
        let meta = s.frequency || 'mensual';
        if (s.dayOfMonth) meta += ` · día ${s.dayOfMonth}`;
        else if (s.timesPerMonth) meta += ` · ${s.timesPerMonth}×/mes`;
        return `<div class="cost-item" id="cost-item-${s.id}">
            <div class="cost-item-icon" style="background:${cat.bg}">${cat.icon}</div>
            <div class="cost-item-info">
                <div class="cost-name-wrap">
                    <div class="cost-item-name" id="cost-name-${s.id}">${s.name}</div>
                    <button class="cost-name-edit-btn" onclick="inlineRenameCost('${s.id}')" title="Renombrar">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                </div>
                <div class="cost-item-meta">${meta}</div>
            </div>
            <div class="cost-item-amt">${s.amount !== monthly ? `${eur(-s.amount)} (${eur(-monthly)}/mes)` : eur(-monthly) + '/mes'}</div>
            <div class="cost-item-actions">
                <button class="cost-action-btn" onclick="editFixedCost('${s.id}')" title="Editar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="cost-action-btn" onclick="deleteSubscription('${s.id}')" title="Eliminar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
            </div>
        </div>`;
    }

    const withDaySection = document.getElementById('sub-with-day-section');
    const withDayEl = document.getElementById('sub-with-day');
    const noDaySection = document.getElementById('sub-no-day-section');
    const noDayEl = document.getElementById('sub-no-day');
    const emptyEl = document.getElementById('sub-empty');

    if (withDayEl) {
        withDaySection.style.display = withDay.length > 0 ? 'block' : 'none';
        if (withDay.length > 0) withDayEl.innerHTML = withDay.map(buildCostItem).join('');
    }
    if (noDayEl) {
        noDaySection.style.display = noDay.length > 0 ? 'block' : 'none';
        if (noDay.length > 0) noDayEl.innerHTML = noDay.map(buildCostItem).join('');
    }
    if (emptyEl) emptyEl.style.display = manual.length === 0 ? 'block' : 'none';

    // AI suggestions
    const aiSection = document.getElementById('sub-ai-section');
    const aiEl = document.getElementById('sub-ai-list');
    if (aiEl && ai.length > 0) {
        if (aiSection) aiSection.style.display = 'block';
        aiEl.innerHTML = ai.slice(0, 5).map(s => `
        <div class="ai-sug-item">
            <div style="font-size:18px;">🔄</div>
            <div>
                <div class="ai-sug-name">${s.desc}</div>
                <div class="ai-sug-meta">Detectado ${s.count} veces · importe recurrente</div>
            </div>
            <div class="ai-sug-amt">${eur(-s.amt)}/mes</div>
            <button class="cost-action-btn" onclick="openCostModal(); document.getElementById('cost-form-name').value='${s.desc.replace(/'/g,"\\'")}'; document.getElementById('cost-form-amt').value=${s.amt}" style="color:var(--green)" title="Añadir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button class="cost-action-btn" onclick="hideAISubscription('${s.desc.replace(/'/g,"\\'")}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`).join('');
    } else if (aiSection) {
        aiSection.style.display = 'none';
    }
}

async function deleteSubscription(id) {
    if (!confirm('¿Eliminar este coste fijo?')) return;
    await tokenFetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
    loadSubscriptionsData();
}

function hideAISubscription(signature) {
    const hidden = JSON.parse(localStorage.getItem('hidden_subs') || '[]');
    hidden.push(signature.substring(0, 12).toLowerCase());
    localStorage.setItem('hidden_subs', JSON.stringify(hidden));
    loadSubscriptionsData();
}

function toMonthly(s) {
    if (s.frequency === 'anual') return s.amount / 12;
    if (s.frequency === 'trimestral') return s.amount / 3;
    if (s.frequency === 'quincenal') return s.amount * 2;
    if (s.frequency === 'irregular') return s.amount * (s.timesPerMonth || 1);
    return s.amount;
}

function renderSubscriptionsManager(manual, ai) {
    const withDay = manual.filter(s => s.dayOfMonth);
    const noDay   = manual.filter(s => !s.dayOfMonth);
    const totalMonthly = manual.reduce((sum, s) => sum + toMonthly(s), 0);

    // Total badge
    if (document.getElementById('f-sub-total')) {
        document.getElementById('f-sub-total').textContent = totalMonthly > 0 ? eur(-totalMonthly) + '/mes' : '—/mes';
    }

    // Burden bar
    const burdenWrap = document.getElementById('burden-wrap');
    if (burdenWrap && totalMonthly > 0) {
        const avgIncome = currentFinTxs.filter(t => t.amount > 0).length > 0
            ? currentFinTxs.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0) / Math.max(1, [...new Set(currentFinTxs.map(t => t.date.substring(0,7)))].length)
            : 0;
        const burdPct = avgIncome > 0 ? Math.min(100, (totalMonthly / avgIncome * 100)) : 0;
        burdenWrap.style.display = 'block';
        document.getElementById('burden-bar').style.width = burdPct.toFixed(1) + '%';
        document.getElementById('burden-pct-lbl').textContent = avgIncome > 0 ? `${burdPct.toFixed(1)}% de tus ingresos` : 'Configura ingresos para ver %';
        document.getElementById('burden-total-lbl').textContent = eur(-totalMonthly) + '/mes en costes fijos';
    }

    // Calendar — current month, proper day-of-week alignment
    const calSection = document.getElementById('cost-calendar-section');
    const cal = document.getElementById('cost-calendar');
    if (cal && withDay.length > 0) {
        calSection.style.display = 'block';
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const today = now.getDate();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        // Monday-first offset: Sun=0 → offset=6, Mon=0 → offset=0
        const firstDow = new Date(year, month, 1).getDay();
        const offset = (firstDow + 6) % 7;
        const dayHeaders = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
        let html = dayHeaders.map(d =>
            `<div style="text-align:center;font-size:10px;font-weight:700;color:var(--text-3);padding:4px 0;">${d}</div>`
        ).join('');
        // Empty cells before day 1
        for (let i = 0; i < offset; i++) {
            html += `<div class="cal-day" style="opacity:0;pointer-events:none;"></div>`;
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const onDay = withDay.filter(s => s.dayOfMonth == d);
            const has = onDay.length > 0;
            const isToday = d === today;
            const todayCls = isToday ? ' cal-today' : '';
            if (has) {
                const rawName = onDay[0].name;
                const cleanName = rawName
                    .replace(/^compra\s+/i, '')
                    .replace(/^paypal\s*\*/i, '')
                    .split(/[,\s]+/)[0];
                const dispName = cleanName.length > 7 ? cleanName.substring(0, 6) + '…' : cleanName;
                const tooltip = onDay.map(s => s.name).join(', ');
                html += `<div class="cal-day has-cost${todayCls}" title="${tooltip}" onclick="editFixedCost('${onDay[0].id}')">
                    <span class="cal-day-num">${d}</span>
                    <span class="cal-day-name">${dispName}</span>
                </div>`;
            } else {
                html += `<div class="cal-day${todayCls}"><span class="cal-day-num">${d}</span></div>`;
            }
        }
        cal.innerHTML = html;
    } else if (calSection) {
        calSection.style.display = 'none';
    }

    function buildCostItem(s) {
        const cat = COST_CATEGORIES[s.category] || COST_CATEGORIES['Otro'];
        const monthly = toMonthly(s);
        let meta = s.frequency || 'mensual';
        if (s.dayOfMonth) meta += ` · día ${s.dayOfMonth}`;
        else if (s.timesPerMonth) meta += ` · ${s.timesPerMonth}×/mes`;
        return `
        <div class="cost-item" id="cost-item-${s.id}">
            <div class="cost-item-icon" style="background:${cat.bg}">${cat.icon}</div>
            <div class="cost-item-info">
                <div class="cost-name-wrap">
                    <div class="cost-item-name" id="cost-name-${s.id}">${s.name}</div>
                    <button class="cost-name-edit-btn" onclick="inlineRenameCost('${s.id}')" title="Renombrar">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                </div>
                <div class="cost-item-meta">${meta}</div>
            </div>
            <div class="cost-item-amt">${s.amount !== monthly ? `${eur(-s.amount)} (${eur(-monthly)}/mes)` : eur(-monthly) + '/mes'}</div>
            <div class="cost-item-actions">
                <button class="cost-action-btn" onclick="editFixedCost('${s.id}')" title="Editar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="cost-action-btn" onclick="deleteSubscription('${s.id}')" title="Eliminar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>
        </div>`;
    }

    // With-day section
    const withDaySection = document.getElementById('costs-with-day-section');
    const withDayEl = document.getElementById('costs-with-day');
    if (withDayEl) {
        if (withDay.length > 0) {
            withDaySection.style.display = 'block';
            withDayEl.innerHTML = withDay.map(buildCostItem).join('');
        } else {
            withDaySection.style.display = 'none';
        }
    }

    // No-day section
    const noDaySection = document.getElementById('costs-no-day-section');
    const noDayEl = document.getElementById('costs-no-day');
    if (noDayEl) {
        if (noDay.length > 0) {
            noDaySection.style.display = 'block';
            noDayEl.innerHTML = noDay.map(buildCostItem).join('');
        } else {
            noDaySection.style.display = 'none';
        }
    }

    // Empty state
    const emptyEl = document.getElementById('costs-empty');
    if (emptyEl) emptyEl.style.display = manual.length === 0 ? 'block' : 'none';

    // AI suggestions
    const aiSection = document.getElementById('ai-suggestions-section');
    const aiEl = document.getElementById('subs-ai-list');
    if (aiEl && ai.length > 0) {
        aiSection.style.display = 'block';
        aiEl.innerHTML = ai.slice(0, 5).map(s => `
        <div class="ai-sug-item">
            <div style="font-size:18px;">🤖</div>
            <div>
                <div class="ai-sug-name">${s.desc}</div>
                <div class="ai-sug-meta">Detectado ${s.count} veces · importe recurrente</div>
            </div>
            <div class="ai-sug-amt">${eur(-s.amt)}/mes</div>
            <button class="cost-action-btn" onclick="openCostModal(); document.getElementById('cost-form-name').value='${s.desc.replace(/'/g,"\\'")}'; document.getElementById('cost-form-amt').value=${s.amt}" style="color:var(--green)" title="Añadir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button class="cost-action-btn" onclick="hideAISubscription('${s.desc.replace(/'/g,"\\'")}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`).join('');
    } else if (aiSection) {
        aiSection.style.display = 'none';
    }
}

// --- INSIGHTS & 50/30/20 ---
function renderRule503020(cats) {
    const total = cats.needs + cats.wants + cats.savings || 1;
    const rows = [
        { label: 'Necesidades', goal: 50, p: cats.needs / total * 100, color: '#2563EB', hint: 'Vivienda, comida, servicios' },
        { label: 'Deseos', goal: 30, p: cats.wants / total * 100, color: '#8B5CF6', hint: 'Ocio, ropa, restaurantes' },
        { label: 'Ahorro / Inversión', goal: 20, p: cats.savings / total * 100, color: '#10B981', hint: 'Inversión, emergencias' }
    ];
    const el = document.getElementById('rule-503020-container');
    if (el) el.innerHTML = rows.map(r => {
        const status = r.p > r.goal + 10 ? '🔴' : r.p < r.goal - 10 ? '🟡' : '🟢';
        return `
                <div style="margin-bottom:14px">
                    <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;">
                        <span>${r.label} <span style="color:var(--text-3);font-weight:400;">(${r.goal}%)</span></span>
                        <span style="font-family:'JetBrains Mono',monospace;">${r.p.toFixed(0)}% ${status}</span>
                    </div>
                    <div style="height:8px; background:var(--bg2); border-radius:4px; position:relative;">
                        <div style="position:absolute; top:0; left:0; height:100%; width:${r.goal}%; border-right:2px dashed rgba(0,0,0,0.2);"></div>
                        <div style="width:${Math.min(r.p, 100)}%; background:${r.color}; height:100%; border-radius:4px;"></div>
                    </div>
                </div>`;
    }).join('');
}

function generateFinanceInsights(runway, saveRate, avgSave, lastBal) {
    const list = document.getElementById('finance-insights-list');
    if (!list) return;

    const runwayColor  = runway < 3 ? 'var(--red)' : runway < 6 ? '#D97706' : 'var(--green)';
    const runwayStatus = runway < 3 ? 'Crítico' : runway < 6 ? 'Mejorable' : 'Saludable';
    const runwayIcon   = runway < 3 ? '⚠️' : runway < 6 ? '🛡️' : '✅';
    const runwayHint   = runway < 6 ? 'Objetivo: 6+ meses de gastos' : 'Listo para invertir excedente';

    const srColor  = saveRate > 25 ? 'var(--green)' : saveRate > 0 ? 'var(--accent)' : 'var(--red)';
    const srStatus = saveRate > 25 ? 'Excelente' : saveRate > 0 ? 'Mejorable' : 'Déficit';
    const srIcon   = saveRate > 25 ? '🚀' : saveRate > 0 ? '📈' : '🔴';
    const srHint   = saveRate > 25 ? 'Patrón de alto ahorro' : saveRate > 0 ? 'Meta: superar el 20%' : 'Reducir gastos no esenciales';

    const cards = [
        { icon: runwayIcon, color: runwayColor, label: 'Colchón',       metric: `${runway.toFixed(1)} meses`, status: runwayStatus, hint: runwayHint },
        { icon: srIcon,     color: srColor,     label: 'Tasa de Ahorro', metric: `${saveRate.toFixed(1)}%`,    status: srStatus,      hint: srHint },
    ];

    if (lastBal !== null && lastBal !== undefined && avgSave) {
        const diff = lastBal - avgSave;
        const tColor = diff >= 0 ? 'var(--green)' : 'var(--red)';
        cards.push({
            icon: diff >= 0 ? '📉' : '📈', color: tColor, label: 'vs Media Anual',
            metric: `${diff >= 0 ? '+' : ''}${eur(diff)}`,
            status: diff >= 0 ? 'Por encima' : 'Por debajo',
            hint: `Ahorro medio: ${eur(avgSave)}/mes`
        });
    }

    const cardHtml = c => `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;border-top:3px solid ${c.color};min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <span style="font-size:18px;line-height:1;">${c.icon}</span>
                <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${c.color};background:${c.color === 'var(--green)' ? 'rgba(16,185,129,.12)' : c.color === 'var(--red)' ? 'rgba(239,68,68,.12)' : 'rgba(37,99,235,.12)'};padding:3px 8px;border-radius:100px;">${c.status}</span>
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;color:${c.color};margin-bottom:3px;line-height:1;">${c.metric}</div>
            <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:3px;">${c.label}</div>
            <div style="font-size:10px;color:var(--text-3);line-height:1.3;">${c.hint}</div>
        </div>`;

    list.style.display = 'grid';
    list.style.gridTemplateColumns = 'repeat(auto-fit,minmax(130px,1fr))';
    list.style.gap = '10px';
    list.innerHTML = cards.map(cardHtml).join('');
}

function renderTopCategories(catTotals) {
    const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
    const el = document.getElementById('top-cats-list');
    if (!el) return;
    if (!sorted.length) { el.innerHTML = '<p style="color:var(--text-3);font-size:12px;text-align:center;padding:12px 0;">Sin datos.</p>'; return; }

    const hasSelection = selectedExpenseCategories.size > 0;
    const tiles = sorted.map(([name, val]) => {
        const p = (val / total * 100).toFixed(1);
        const color = expenseCatColorMap[name] || '#6B7280';
        const isSelected = selectedExpenseCategories.has(name);
        const opacity = hasSelection ? (isSelected ? '1' : '0.32') : '0.88';
        const ring = isSelected ? 'outline:2.5px solid rgba(255,255,255,0.85);outline-offset:-3px;' : '';
        const safecat = name.replace(/'/g, "\\'");
        return `<div class="exp-cat-tile" data-cat="${name.replace(/"/g,'&quot;')}" onclick="toggleExpenseCat('${safecat}')" style="flex:${val};min-width:84px;background:${color};border-radius:10px;padding:10px 12px;cursor:pointer;transition:transform 0.15s,opacity 0.15s;opacity:${opacity};${ring}" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
            <div style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.72);text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:#fff;line-height:1.2;">${eur(-val)}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.6);margin-top:3px;">${p}%</div>
        </div>`;
    }).join('');

    el.innerHTML = `<div class="exp-cat-treemap" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px;">${tiles}</div>`;
}

function toggleExpenseCat(catName) {
    if (selectedExpenseCategories.has(catName)) {
        selectedExpenseCategories.delete(catName);
    } else {
        selectedExpenseCategories.add(catName);
    }
    const hasSelection = selectedExpenseCategories.size > 0;
    document.querySelectorAll('.exp-cat-tile').forEach(tile => {
        const n = tile.dataset.cat;
        const isSel = selectedExpenseCategories.has(n);
        tile.style.opacity = hasSelection ? (isSel ? '1' : '0.32') : '0.88';
        tile.style.outline = isSel ? '2.5px solid rgba(255,255,255,0.85)' : 'none';
        tile.style.outlineOffset = isSel ? '-3px' : '0';
    });
    if (currentBreakdownTxs) renderSubcategoryBreakdown(currentBreakdownTxs);
}

function clearExpenseCatFilter() {
    selectedExpenseCategories.clear();
    document.querySelectorAll('.exp-cat-tile').forEach(tile => {
        tile.style.opacity = '0.88';
        tile.style.outline = 'none';
    });
    if (currentBreakdownTxs) renderSubcategoryBreakdown(currentBreakdownTxs);
}

// ─── ASSET MANAGER & MULTIVERSE (Kept intact) ───
function openCategoryModal() { document.getElementById('cat-ov').style.display = 'flex'; fetchCategories(); }
function closeCatModal() { document.getElementById('cat-ov').style.display = 'none'; }
async function fetchCategories() {
    const r = await tokenFetch('/api/categories'); const cats = await r.json(); renderCategoryList(cats);
}
function renderCategoryList(cats) {
    const list = document.getElementById('cat-list'); if (!list) return; list.innerHTML = '';
    cats.forEach(cat => {
        const div = document.createElement('div'); div.className = 'card'; div.style.padding = '16px'; div.style.border = `1px solid ${cat.color || 'var(--border)'}33`;
        let sh = cat.subcategories.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--bg);border-radius:5px;font-size:12px"><span>${s.name}</span><div><button onclick="renameSubcategory('${s.id}', '${s.name.replace(/'/g, "\\'")}')" style="border:none;background:none;cursor:pointer;color:var(--text-3);font-size:14px;margin-right:6px">✏️</button><button onclick="deleteSubcategory('${s.id}')" style="border:none;background:none;cursor:pointer;color:var(--red);font-size:15px">×</button></div></div>`).join('');
        div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="font-weight:700;color:${cat.color || 'var(--text)'}">${cat.name}</span><div><button onclick="renameCategory('${cat.id}', '${cat.name.replace(/'/g, "\\'")}')" style="border:none;background:none;cursor:pointer;color:var(--text-3);font-size:12px;margin-right:8px">✏️ Renombrar</button><button onclick="deleteCategory('${cat.id}')" style="border:none;background:none;cursor:pointer;color:var(--text-3);font-size:12px">🗑️ Eliminar</button></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${sh}<div style="display:flex;gap:4px"><input type="text" placeholder="Nueva..." id="new-sub-${cat.id}" class="form-input" style="font-size:11px;padding:6px 8px"><button onclick="addSubcategory('${cat.id}')" class="btn-action btn-primary" style="padding:6px 10px">+</button></div></div>`;
        list.appendChild(div);
    });
}
async function renameCategory(id, currentName) { const newName = prompt('Nombre:', currentName); if (!newName || newName === currentName) return; await tokenFetch('/api/categories', { method: 'POST', body: JSON.stringify({ id: id, name: newName }) }); fetchCategories(); }
async function renameSubcategory(id, currentName) { const newName = prompt('Nombre:', currentName); if (!newName || newName === currentName) return; await tokenFetch('/api/subcategories', { method: 'POST', body: JSON.stringify({ id: id, name: newName }) }); fetchCategories(); }
async function addCategory() { const n = document.getElementById('new-cat-name').value; if (!n) return; await tokenFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: n }) }); document.getElementById('new-cat-name').value = ''; fetchCategories(); }
async function deleteCategory(id) { if (!confirm('¿Seguro?')) return; await tokenFetch(`/api/categories/${id}`, { method: 'DELETE' }); fetchCategories(); }
async function addSubcategory(catId) { const inp = document.getElementById(`new-sub-${catId}`); const n = inp.value; if (!n) return; await tokenFetch('/api/subcategories', { method: 'POST', body: JSON.stringify({ name: n, category_id: catId }) }); inp.value = ''; fetchCategories(); }
async function deleteSubcategory(id) { await tokenFetch(`/api/subcategories/${id}`, { method: 'DELETE' }); fetchCategories(); }

let currentFilter = 'ALL', allConfigs = [];
function openAssetManager() { document.getElementById('modal-manage').classList.add('open'); switchTab('list'); fetchConfigs(); }
function closeAssetManager() {
    document.getElementById('modal-manage').classList.remove('open');
    if (window._obAssetCallback) { const cb = window._obAssetCallback; window._obAssetCallback = null; cb(); }
}

// Overlay click-to-close: only fires when BOTH mousedown AND mouseup happened on the
// overlay itself — dragging from inside the card out does NOT trigger the close.
(function initOverlayDragProtection() {
    function protect(overlayId, closeFn) {
        const el = document.getElementById(overlayId);
        if (!el) return;
        let downOnOverlay = false;
        el.addEventListener('mousedown', e => { downOnOverlay = e.target === el; });
        el.addEventListener('mouseup',   e => { if (downOnOverlay && e.target === el) closeFn(); downOnOverlay = false; });
    }
    protect('modal-manage', closeAssetManager);
    protect('cat-ov', closeCatModal);
    protect('modal-cost-manager', closeCostModal);
}());
function switchTab(tab) { document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-btn-${tab}`)); document.getElementById('tab-list').style.display = tab === 'list' ? 'block' : 'none'; document.getElementById('tab-add').style.display = tab === 'add' ? 'block' : 'none'; if (tab === 'add') { document.getElementById('asset-form').reset(); document.getElementById('asset-id').value = ''; document.getElementById('btn-save-asset').textContent = 'Guardar Activo'; setSubtype('cash'); } }
function setFilter(f) { currentFilter = f; renderConfigList(); }
function setSubtype(st) {
    document.getElementById('asset-subtype').value = st;
    // Button IDs: cash → sub-btn-cash, market → sub-btn-market, indexa → sub-btn-robo
    ['cash', 'market', 'robo'].forEach(b => {
        const el = document.getElementById(`sub-btn-${b}`);
        if (el) el.classList.toggle('active', (b === 'robo' ? 'indexa' : b) === st || (b === st));
    });
    document.getElementById('market-fields').style.display = st === 'market' ? 'block' : 'none';
    document.getElementById('ticker-group').style.display  = st === 'market' ? 'block' : 'none';
    document.getElementById('robo-fields').style.display   = st === 'indexa' ? 'block' : 'none';
    document.getElementById('cash-fields').style.display   = st === 'cash'   ? 'block' : 'none';
    document.getElementById('invested-group').style.display = st === 'cash'  ? 'none'  : 'block';
    document.getElementById('asset-invested').required = st !== 'cash';
    const hl = document.getElementById('holdings-label'), hh = document.getElementById('holdings-hint'), ps = document.getElementById('asset-portfolio');
    const ai = document.getElementById('cash-anchor-info');
    if (st === 'cash') {
        hl.textContent = 'Saldo Total (€)';
        hh.textContent = 'Introduce el saldo real actual. Las transacciones posteriores a hoy se sumarán al sincronizar.';
        ps.value = 'CASH'; ps.disabled = true;
        toggleCashSync();
    } else if (st === 'market') {
        hl.textContent = 'Unidades'; hh.textContent = 'Número de títulos o monedas.';
        document.getElementById('asset-type').value = 'auto'; ps.disabled = false;
        if (ai) ai.style.display = 'none';
    } else { // indexa / gestoras
        hl.textContent = 'Valor Actual (€)'; hh.textContent = 'Se actualizará automáticamente con la API.';
        ps.value = 'FUNDS'; ps.disabled = true;
        if (ai) ai.style.display = 'none';
        onRoboProviderChange();
    }
}
function onRoboProviderChange() {
    const provider = document.getElementById('robo-provider')?.value || 'indexa';
    // Currently only Indexa fields exist; extend here when adding new providers
    const idxFields = document.getElementById('robo-indexa-fields');
    if (idxFields) idxFields.style.display = provider === 'indexa' ? 'block' : 'none';
}
function toggleCashSync() {
    const mode = document.getElementById('cash-sync-mode').value;
    document.getElementById('cash-bank-group').style.display = mode === 'auto' ? 'block' : 'none';
    document.getElementById('asset-type').value = mode;
    const anchorInfo = document.getElementById('cash-anchor-info');
    if (anchorInfo) anchorInfo.style.display = mode === 'auto' ? 'block' : 'none';
}
async function fetchConfigs() { const r = await tokenFetch('/api/configs'); allConfigs = await r.json(); renderConfigList(); }
function renderConfigList() { const list = document.getElementById('asset-configs-list'), subNav = document.getElementById('sub-nav-list'); if (!list) return; const counts = { ALL: allConfigs.length, CASH: 0, FUNDS: 0, CRYPTO: 0, ETFS: 0, OTROS: 0 }; allConfigs.forEach(c => { if (counts[c.portfolio] !== undefined) counts[c.portfolio]++; else counts.OTROS++; }); const labels = { ALL: 'Todos', CASH: 'Efectivo', FUNDS: 'Fondos', CRYPTO: 'Crypto', ETFS: 'ETFs', OTROS: 'Otros' }; subNav.innerHTML = ['ALL', 'CASH', 'FUNDS', 'CRYPTO', 'ETFS', 'OTROS'].map(f => `<button class="sub-btn ${currentFilter === f ? 'active' : ''}" onclick="setFilter('${f}')">${labels[f]} ${counts[f]}</button>`).join(''); const fi = currentFilter === 'ALL' ? allConfigs : allConfigs.filter(c => c.portfolio === currentFilter || (currentFilter === 'OTROS' && !['CASH', 'FUNDS', 'CRYPTO', 'ETFS'].includes(c.portfolio))); list.innerHTML = fi.map(c => `<div class="config-item"><div><div style="font-weight:500">${c.name}</div><div style="font-size:11px;color:var(--text-3)">${c.portfolio} · ${c.subtype === 'market' ? (c.ticker || 'N/A') : c.subtype.toUpperCase()}</div></div><div style="display:flex;gap:8px"><button class="btn-action" onclick="editConfig('${c.id}')" style="padding:4px 10px;font-size:11px">Editar</button><button class="btn-action" onclick="deleteConfig('${c.id}')" style="padding:4px 10px;font-size:11px;background:rgba(220,38,38,0.06);color:var(--red);border-color:rgba(220,38,38,0.15)">Borrar</button></div></div>`).join('') || '<div style="text-align:center;color:var(--text-3);padding:32px">No hay activos en esta categoría.</div>'; }
let searchTimeoutGlobal; function onSearchInput(val) { clearTimeout(searchTimeoutGlobal); if (val.length < 2) { document.getElementById('search-results').style.display = 'none'; return; } searchTimeoutGlobal = setTimeout(async () => { const port = document.getElementById('asset-portfolio').value; const r = await tokenFetch(`/api/search?q=${val}&portfolio=${port}`); const results = await r.json(); const container = document.getElementById('search-results'); container.innerHTML = results.map(r => `<div class="search-item" onclick="selectTicker('${r.symbol}','${r.name}')"><b>${r.display_symbol || r.symbol}</b> — ${r.name} (${r.exch})</div>`).join(''); container.style.display = results.length ? 'block' : 'none'; }, 300); }
function selectTicker(symbol, name) { document.getElementById('asset-ticker').value = symbol; document.getElementById('asset-name').value = name; document.getElementById('search-results').style.display = 'none'; }
async function saveAsset() {
    let finalType   = document.getElementById('asset-type').value || 'manual';
    let finalTicker = document.getElementById('asset-ticker').value;
    const subtype   = document.getElementById('asset-subtype').value;
    const holdingsRaw  = document.getElementById('asset-holdings').value;
    const investedRaw  = document.getElementById('asset-invested').value;
    // Send as numbers so Python comparisons (new_holdings != old_holdings) work correctly
    let holdingsVal  = holdingsRaw  !== '' ? parseFloat(holdingsRaw)  : 0;
    let investedVal  = investedRaw  !== '' ? parseFloat(investedRaw)  : 0;
    if (subtype === 'cash') {
        investedVal = holdingsVal;
        if (document.getElementById('cash-sync-mode').value === 'auto') {
            finalType   = 'auto';
            finalTicker = document.getElementById('cash-bank-source').value;
        }
    }
    const data = {
        id: document.getElementById('asset-id').value || null,
        name: document.getElementById('asset-name').value,
        portfolio: document.getElementById('asset-portfolio').value,
        subtype,
        type: finalType,
        ticker: finalTicker,
        holdings: holdingsVal,
        invested_total: investedVal
    };
    const btn = document.getElementById('btn-save-asset');
    btn.textContent = 'Guardando…'; btn.disabled = true;
    try {
        const r = await tokenFetch('/api/configs', { method: 'POST', body: JSON.stringify(data) });
        if (r && r.ok) {
            switchTab('list');
            await tokenFetch('/api/sync/all', { method: 'POST' });
            await fetchConfigs();
            if (typeof init === 'function') await init();
        }
    } finally {
        btn.textContent = 'Guardar Activo'; btn.disabled = false;
    }
}
function editConfig(id) {
    const c = allConfigs.find(x => x.id === id); if (!c) return;
    // For cash: always use c.holdings (last value the user set / sync computed).
    // For market: use the snapshot's holdings count (number of units/shares).
    let currentHoldings = c.holdings;
    if (c.subtype !== 'cash' && DATA && DATA.portfolios_grouped) {
        for (const g of Object.values(DATA.portfolios_grouped)) {
            const found = g.assets.find(a => a.name.trim().toLowerCase() === c.name.trim().toLowerCase());
            if (found) { currentHoldings = found.holdings; break; }
        }
    }
    switchTab('add');
    setTimeout(() => {
        document.getElementById('asset-id').value = c.id;
        document.getElementById('asset-name').value = c.name;
        document.getElementById('asset-portfolio').value = c.portfolio;
        document.getElementById('asset-subtype').value = c.subtype;
        document.getElementById('asset-type').value = c.type;
        document.getElementById('asset-ticker').value = c.ticker || '';
        document.getElementById('asset-holdings').value = currentHoldings;
        document.getElementById('asset-invested').value = c.invested_total;
        if (c.subtype === 'cash') {
            const syncMode = c.type === 'auto' ? 'auto' : 'manual';
            document.getElementById('cash-sync-mode').value = syncMode;
            if (c.type === 'auto' && c.ticker) document.getElementById('cash-bank-source').value = c.ticker;
            // Show anchor info for auto cash accounts
            const anchorInfo = document.getElementById('cash-anchor-info');
            const anchorLabel = document.getElementById('anchor-date-label');
            if (anchorInfo && syncMode === 'auto') {
                anchorInfo.style.display = 'block';
                if (anchorLabel) {
                    const d = c.manual_balance_date;
                    anchorLabel.textContent = d ? new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'primera vez que guardes';
                }
            }
        }
        setSubtype(c.subtype || 'market');
        document.getElementById('btn-save-asset').textContent = 'Actualizar Activo';
    }, 10);
}
async function deleteConfig(id) { if (!confirm('¿Eliminar este activo?')) return; const r = await tokenFetch(`/api/configs/${id}`, { method: 'DELETE' }); if (r.ok) fetchConfigs(); }
async function syncIndexa() { const btn = document.getElementById('btn-sync-all'), icon = document.getElementById('sync-icon-indexa'); btn.style.opacity = '.6'; btn.style.pointerEvents = 'none'; icon.classList.add('spinning'); try { await tokenFetch('/api/sync/all', { method: 'POST' }); await init(); } catch (e) { } finally { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; icon.classList.remove('spinning'); } }

let activeVerse = 'fire'; let multiverseChart = null; let hits = JSON.parse(localStorage.getItem('wealth_hitos') || '[]');
function loadRetirementData() { if (!DATA || !DATA.summary) return; renderHitos(); updateMultiverse(); }
function fillFinancials(type) { if (!ALL_TRANSACTIONS || !ALL_TRANSACTIONS.length) return; const now = new Date(); const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(now.getMonth() - 6); const months = {}; ALL_TRANSACTIONS.forEach(t => { const d = new Date(t.date); if (d < sixMonthsAgo || t.category === 'Movimientos') return; const m = t.date.substring(0, 7); if (!months[m]) months[m] = { inc: 0, exp: 0 }; if (t.amount > 0) months[m].inc += t.amount; else months[m].exp += Math.abs(t.amount); }); const monthKeys = Object.keys(months); if (!monthKeys.length) return; const sumInc = monthKeys.reduce((s, k) => s + months[k].inc, 0); const sumExp = monthKeys.reduce((s, k) => s + months[k].exp, 0); if (type === 'income') document.getElementById('m-income').value = Math.round(sumInc / monthKeys.length); else if (type === 'expense') document.getElementById('m-spend').value = Math.round(sumExp / monthKeys.length); updateMultiverse(); }
function fillHistory(type) { if (!DATA || !DATA.history_global) return; if (type === 'roi') { const globalMwr = DATA.summary.global_mwr || 7; document.getElementById('m-roi').value = globalMwr.toFixed(1); } updateMultiverse(); }
function addHito() { const name = document.getElementById('h-name').value; const val = parseFloat(document.getElementById('h-val').value); const date = document.getElementById('h-date').value; if (!name || isNaN(val) || !date) return; hits.push({ id: Date.now(), name, val, date }); localStorage.setItem('wealth_hitos', JSON.stringify(hits)); document.getElementById('h-name').value = ''; document.getElementById('h-val').value = ''; renderHitos(); updateMultiverse(); }
function removeHito(id) { hits = hits.filter(h => h.id !== id); localStorage.setItem('wealth_hitos', JSON.stringify(hits)); renderHitos(); updateMultiverse(); }
function renderHitos() { const container = document.getElementById('hito-list'); if (!container) return; container.innerHTML = hits.sort((a, b) => a.date.localeCompare(b.date)).map(h => `<div class="hito-item"><div class="hito-info"><div class="hito-icon">${h.isMonthly ? '🔄' : '✨'}</div><div><div class="hito-name">${h.name}</div><div class="hito-date">${h.isMonthly ? 'Desde ' : ''}${h.date}</div></div></div><div style="display:flex; align-items:center; gap:12px"><span style="font-weight:700; color:var(--red)">-${eur(h.val)}${h.isMonthly ? '/mes' : ''}</span><div class="hito-remove" onclick="removeHito(${h.id})">×</div></div></div>`).join(''); }
function selectVerse(verse) {
    activeVerse = verse;
    document.querySelectorAll('.verse-card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById(`v-${verse}`); if (card) card.classList.add('active');
    updateMultiverse();
}
function updateMultiverse() {
    const income     = parseFloat(document.getElementById('m-income').value) || 0;
    const incG       = parseFloat(document.getElementById('m-inc-growth').value) || 0;
    const spend      = parseFloat(document.getElementById('m-spend').value) || 0;
    const expG       = parseFloat(document.getElementById('m-exp-growth').value) || 0;
    const roi        = parseFloat(document.getElementById('m-roi').value) || 7;
    const investRate = parseFloat(document.getElementById('m-invest-rate').value) || 80;
    const extraSave  = parseFloat(document.getElementById('m-save').value) || 0;
    const years      = parseInt(document.getElementById('m-years').value) || 30;
    const totalWealth = DATA?.summary?.total_money || 0;
    const realRoi    = roi / 100;
    const now        = new Date();
    const currentYear = now.getFullYear();

    // ── FIRE calculation ──────────────────────────────────
    const fireNumber = spend * 12 * 25;  // 25× annual expenses
    const firePct    = fireNumber > 0 ? Math.min(100, (totalWealth / fireNumber * 100)) : 0;

    let fireYear = null;
    let fireTempWealth = totalWealth;
    for (let y = 1; y <= 60 && fireYear === null; y++) {
        for (let m = 0; m < 12; m++) {
            const totalMonths = y * 12 + m;
            const curInc = income * Math.pow(1 + incG / 100, totalMonths / 12);
            const curExp = spend  * Math.pow(1 + expG  / 100, totalMonths / 12);
            const curSave = Math.max(0, curInc - curExp) + extraSave;
            const invested = curSave * (investRate / 100);
            fireTempWealth = (fireTempWealth + invested) * (1 + realRoi / 12);
            if (fireTempWealth >= fireNumber) { fireYear = currentYear + y + m / 12; break; }
        }
    }
    const yearsToFire = fireYear ? Math.ceil(fireYear - currentYear) : null;

    // Update FIRE KPI strip
    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('fire-number-val', eur(fireNumber));
    const fkb = document.getElementById('fire-kpi-bar'); if (fkb) fkb.style.width = firePct.toFixed(1) + '%';
    setEl('fire-year-val', fireYear ? Math.round(fireYear).toString() : '>2085');
    setEl('fire-years-left-lbl', yearsToFire ? `Faltan ~${yearsToFire} años` : 'Aumenta tu tasa de ahorro');

    // ── Runway ────────────────────────────────────────────
    let runwayWealth = totalWealth;
    let monthsRunway = 0;
    for (let m = 1; m <= 600; m++) {
        const cur = new Date(now.getFullYear(), now.getMonth() + m);
        const dateStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`;
        const curExp  = spend * Math.pow(1 + expG / 100, m / 12);
        const hitoTotal  = hits.filter(h => !h.isMonthly && h.date === dateStr).reduce((s,h) => s + h.val, 0);
        const recurTotal = hits.filter(h =>  h.isMonthly && dateStr >= h.date).reduce((s,h) => s + h.val, 0);
        runwayWealth -= hitoTotal + curExp + recurTotal;
        if (runwayWealth <= 0) { monthsRunway = m; break; }
    }
    setEl('stat-runway', `${monthsRunway}`);
    setEl('stat-runway-years', `${(monthsRunway / 12).toFixed(1)} años`);
    setEl('fire-runway-top', `${monthsRunway} meses`);
    const rb = document.getElementById('runway-bar'); if (rb) rb.style.width = `${Math.min(100, (monthsRunway/48)*100)}%`;

    // ── SWR / Nomad ───────────────────────────────────────
    const monthlySWR = (totalWealth * 0.04) / 12;
    // SWR in `years` years (future portfolio with savings)
    let futureWealth = totalWealth;
    for (let y = 0; y < years; y++) {
        for (let m2 = 0; m2 < 12; m2++) {
            const totalM = y * 12 + m2;
            const curInc = income * Math.pow(1 + incG/100, totalM/12);
            const curExp2 = spend * Math.pow(1 + expG/100, totalM/12);
            const curSave2 = Math.max(0, curInc - curExp2) + extraSave;
            futureWealth = (futureWealth + curSave2 * (investRate/100)) * (1 + realRoi/12);
        }
    }
    const futureSWR = (futureWealth * 0.04) / 12;
    setEl('stat-swr-monthly', eur(monthlySWR) + '/mes');
    setEl('stat-swr-future', eur(futureSWR) + '/mes');
    setEl('fire-swr-val', eur(monthlySWR) + '/mes');
    setEl('swr-future-years', years.toString());

    const checkTier = (id, cost) => {
        const el = document.getElementById(id); if (!el) return;
        if (monthlySWR >= cost) { el.textContent = '✓ Libre'; el.className = 'tier-unlocked'; }
        else { el.textContent = eur(-(cost - monthlySWR)) + ' restante'; el.className = 'tier-locked'; }
    };
    checkTier('tier-sea', 1000); checkTier('tier-ee', 1600); checkTier('tier-es', 2400);

    // ── Gap Year ──────────────────────────────────────────
    // Opportunity cost = what compounding loses in 1 year of no saving × future value
    const gapCompLoss = totalWealth * realRoi; // 1 year of compounding lost on existing wealth
    const gapSavingsLost = Math.max(0, income - spend) * 12 + extraSave * 12;
    const gapFutureCost = (gapCompLoss + gapSavingsLost) * Math.pow(1 + realRoi, Math.max(0, years - 1));
    const gapRecovery = gapSavingsLost > 0 ? (gapFutureCost / (Math.max(0, income - spend + extraSave) * 12)).toFixed(1) : '∞';
    setEl('stat-gap-cost', eur(-gapFutureCost));
    setEl('stat-gap-recovery', `${gapRecovery} años`);

    // ── Compounder ────────────────────────────────────────
    let compWealth = totalWealth;
    for (let i = 0; i < years; i++) compWealth *= (1 + realRoi);
    const compMultiplier = totalWealth > 0 ? (compWealth / totalWealth).toFixed(1) : '—';
    setEl('stat-comp-final', eur(compWealth));
    setEl('stat-comp-x', `${compMultiplier}×`);

    // ── FIRE verse stats ──────────────────────────────────
    setEl('stat-fire-years', yearsToFire ? `${yearsToFire} años` : '>60 años');
    setEl('stat-fire-pct', firePct.toFixed(1) + '%');
    setEl('stat-fire-now', eur(totalWealth));
    setEl('stat-fire-target', eur(fireNumber));
    const fpb = document.getElementById('fire-prog-bar'); if (fpb) fpb.style.width = firePct.toFixed(1) + '%';

    renderMultiverseChart(totalWealth, income, incG, spend, expG, extraSave, realRoi, investRate, years);
    updateInsight(activeVerse, monthsRunway, monthlySWR, gapFutureCost, compWealth, fireYear, yearsToFire, fireNumber, firePct);
}
function updateInsight(verse, runway, swr, gap, comp, fireYear, yearsToFire, fireNumber, firePct) {
    const el = document.getElementById('multiverse-insight'); if (!el) return;
    const spend = parseFloat(document.getElementById('m-spend').value) || 0;
    const expG = parseFloat(document.getElementById('m-exp-growth').value) || 0;
    const years = parseInt(document.getElementById('m-years').value) || 30;
    const insights = {
        fire: fireYear
            ? `Tu <b>Número FIRE es ${eur(fireNumber)}</b>. Llevas el <b>${firePct.toFixed(1)}%</b> del camino completado. Con tu ritmo actual, alcanzarás la independencia financiera en <b>${Math.round(fireYear)}</b> (faltan ~${yearsToFire} años). A partir de entonces, el 4% anual de tu patrimonio cubrirá todos tus gastos sin tocar el capital.`
            : `Tu <b>Número FIRE es ${eur(fireNumber)}</b>. Con los parámetros actuales no se alcanza en 60 años. Aumenta la tasa de ahorro, el ROI o reduce gastos para acelerar el camino.`,
        startup: `En modo <b>Runway</b>, podrías sobrevivir <b>${runway} meses</b> sin ningún ingreso. Tu gasto mensual proyectado al final del período sería de ${eur(spend * Math.pow(1 + expG/100, runway/12))}. ${runway >= 24 ? '✅ Colchón sólido.' : runway >= 12 ? '⚠️ Por debajo de 2 años.' : '🔴 Crítico — prioriza liquidez.'}`,
        nomad: `Con tu capital actual puedes extraer <b>${eur(swr)}/mes</b> de forma sostenible al 4%. En ${years} años, si sigues ahorrando, ese retiro crecería hasta <b>${eur((parseFloat(document.getElementById('fire-swr-val')?.textContent) || 0))}</b>/mes. El mapa de tiers muestra qué estilos de vida ya están desbloqueados.`,
        gap: `Un año sabático hoy te costaría <b>${eur(gap)}</b> de patrimonio futuro proyectado (coste de oportunidad del compounding perdido + ahorro no generado). Es el precio real de parar un año.`,
        compound: `Si no ahorras ni un euro más, el interés compuesto llevaría tu capital hasta <b>${eur(comp)}</b> en ${years} años. Esto demuestra el poder del tiempo: sin hacer nada, tu dinero se multiplica x${(comp / (DATA?.summary?.total_money || 1)).toFixed(1)}.`
    };
    el.innerHTML = insights[verse] || 'Selecciona un escenario para ver el análisis.';
}
function renderMultiverseChart(initial, income, incG, spend, expG, extra, roi, investRate, years) {
    const ctx = document.getElementById('multiverseChart')?.getContext('2d'); if (!ctx) return;
    if (multiverseChart) multiverseChart.destroy();

    const labels = [], dataBase = [], dataVerse = [];
    let currentBase = initial, currentVerse = initial;
    const fireNumber = spend * 12 * 25;
    const now = new Date();

    for (let y = 0; y <= years; y++) {
        labels.push(`${now.getFullYear() + y}`);
        for (let m = 0; m < 12; m++) {
            if (y === 0 && m === 0) continue;
            const cur = new Date(now.getFullYear(), now.getMonth() + y*12 + m);
            const dateStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`;
            const hitoTotal  = hits.filter(h => !h.isMonthly && h.date === dateStr).reduce((s,h) => s+h.val, 0);
            const recurTotal = hits.filter(h =>  h.isMonthly && dateStr >= h.date).reduce((s,h) => s+h.val, 0);
            const curInc = income * Math.pow(1 + incG/100, (y*12+m)/12);
            const curExp = (spend + recurTotal) * Math.pow(1 + expG/100, (y*12+m)/12);
            const curSave = curInc - curExp + extra;
            const invested = Math.max(0, curSave * (investRate/100));
            const liquid   = curSave - invested;
            currentBase = (currentBase + invested) * (1 + roi/12) + liquid - hitoTotal;

            if (activeVerse === 'startup') {
                currentVerse = Math.max(0, currentVerse - curExp - hitoTotal);
            } else if (activeVerse === 'compound') {
                currentVerse = currentVerse * (1 + roi/12) - hitoTotal;
            } else if (activeVerse === 'gap') {
                if (y === 0) currentVerse = currentVerse - curExp - hitoTotal;
                else currentVerse = (currentVerse + invested) * (1 + roi/12) + liquid - hitoTotal;
            } else {
                currentVerse = currentBase; // fire & nomad use base projection
            }
        }
        dataBase.push(Math.round(currentBase));
        dataVerse.push(Math.round(currentVerse));
    }

    // FIRE horizontal line
    const fireLineData = labels.map(() => Math.round(fireNumber));

    multiverseChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Número FIRE (meta)', data: fireLineData, borderColor: 'rgba(21,128,61,0.5)', borderDash: [6,4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0 },
                { label: 'Proyección Base', data: dataBase, borderColor: 'rgba(168,164,156,0.5)', borderDash: [4,4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.35 },
                { label: 'Escenario Activo', data: dataVerse, borderColor: '#2563EB', backgroundColor: 'rgba(37,99,235,0.07)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2.5 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'bottom', align: 'end', labels: { boxWidth: 14, font: { size: 11 }, color: '#5C5A54' } },
                tooltip: { backgroundColor: '#0E0D0B', callbacks: { label: c => ` ${c.dataset.label}: ${eur(c.raw)}` } }
            },
            scales: {
                y: { ticks: { callback: v => eur(v), font: { size: 10 }, color: '#A8A49C' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } },
                x: { grid: { display: false }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, maxTicksLimit: 8 } }
            }
        }
    });
}

// ─── ONBOARDING ──────────────────────────────────────────────────────────────

const OB_BANKS = ['SANTANDER','BBVA','CAIXABANK','ING','REVOLUT','TRADEREPUBLIC','N26','WISE'];

const OB_BANK_INSTRUCTIONS = {
    SANTANDER:     { steps: ['Accede a <strong>santander.es</strong> o la app → Mis cuentas', 'Selecciona tu cuenta → pestaña <strong>Movimientos</strong>', 'Haz clic en <strong>Descargar</strong> → Excel (.xls) o CSV'], note: '💡 Soportamos tanto el Excel del escritorio como el CSV de la app móvil' },
    BBVA:          { steps: ['Accede a <strong>bbva.es</strong> → Mis cuentas', 'Entra en tu cuenta corriente → <strong>Movimientos</strong>', '<strong>Descargar</strong> → Excel (.xlsx)'], note: '💡 Incluye todos los movimientos del rango' },
    CAIXABANK:     { steps: ['Accede a <strong>caixabank.es</strong>', 'Mis cuentas → <strong>Extracto</strong>', '<strong>Descargar extracto</strong> → Excel'], note: '💡 Formato Excel (.xls)' },
    ING:           { steps: ['Accede a <strong>ingdirect.es</strong>', 'Tus productos → selecciona tu cuenta', '<strong>Exportar movimientos</strong> → Excel'], note: '💡 Puedes filtrar por fechas' },
    REVOLUT:       { steps: ['Abre la app <strong>Revolut</strong>', 'Perfil → <strong>Estado de cuenta</strong>', 'Selecciona periodo → <strong>Exportar CSV</strong>'], note: '💡 Elige el balance que quieras exportar' },
    TRADEREPUBLIC: { steps: ['Abre la app <strong>Trade Republic</strong>', 'Perfil → <strong>Documentos</strong>', 'Selecciona <strong>Estado de cuenta CSV</strong>'], note: '💡 Solo incluye transacciones de inversión' },
    N26:           { steps: ['Accede a <strong>app.n26.com</strong>', 'Ve a <strong>Transacciones</strong>', '<strong>Descargar extracto</strong> → CSV'], note: '💡 Exporta el rango completo de fechas' },
    WISE:          { steps: ['Accede a <strong>wise.com</strong>', 'Historial de tu balance principal', '<strong>Descargar</strong> → CSV'], note: '💡 Incluye todas las divisas del balance' },
};

const OB_SUGGESTED_CATS = [
    { name: 'Alimentación', emoji: '🍽️', color: '#D97706', subcats: ['Supermercado', 'Restaurantes', 'Delivery', 'Cafés'] },
    { name: 'Hogar',        emoji: '🏠', color: '#0891B2', subcats: ['Alquiler / Hipoteca', 'Suministros', 'Mantenimiento', 'Decoración'] },
    { name: 'Transporte',   emoji: '🚗', color: '#6B7280', subcats: ['Gasolina', 'Transporte público', 'Parking', 'Taxi / Uber'] },
    { name: 'Ocio',         emoji: '🎮', color: '#7C3AED', subcats: ['Entretenimiento', 'Deportes', 'Salidas', 'Hobbies'] },
    { name: 'Viajes',       emoji: '✈️', color: '#2563EB', subcats: ['Vuelos', 'Hoteles', 'Vacaciones', 'Alquiler coche'] },
    { name: 'Salud',        emoji: '💊', color: '#059669', subcats: ['Farmacia', 'Médico / Dentista', 'Gimnasio', 'Seguro salud'] },
    { name: 'Suscripciones',emoji: '📱', color: '#EC4899', subcats: ['Streaming', 'Software', 'Apps', 'Prensa digital'] },
    { name: 'Compras',      emoji: '🛍️', color: '#F59E0B', subcats: ['Ropa', 'Electrónica', 'Amazon', 'Otros'] },
    { name: 'Formación',    emoji: '📚', color: '#4F46E5', subcats: ['Cursos online', 'Libros', 'Idiomas', 'Universidad'] },
    { name: 'Ingresos',     emoji: '💰', color: '#15803D', subcats: ['Nómina', 'Freelance', 'Dividendos', 'Otros ingresos'] },
    { name: 'Movimientos',  emoji: '🔄', color: '#9CA3AF', subcats: ['Transferencias internas', 'Bizum recibido', 'Reembolsos'] },
];

const OB_AUTOCAT_RULES = [
    { cat: 'Alimentación', sub: 'Supermercado',    kw: ['mercadona','carrefour','lidl','aldi','eroski','dia','consumo','alcampo','hipercor','ahorro'] },
    { cat: 'Alimentación', sub: 'Restaurantes',    kw: ['burger king','mcdonalds','kfc','dominos','telepizza','restaurante','restaurant','bar '] },
    { cat: 'Alimentación', sub: 'Delivery',        kw: ['glovo','ubereats','uber eat','just eat','deliveroo'] },
    { cat: 'Alimentación', sub: 'Cafés',           kw: ['cafe','starbucks','cafeteria','coffee'] },
    { cat: 'Transporte',   sub: 'Gasolina',        kw: ['repsol','bp ','cepsa','shell','gasolinera','gasolina','combustible'] },
    { cat: 'Transporte',   sub: 'Taxi / Uber',     kw: ['uber ','cabify','taxi','bolt'] },
    { cat: 'Transporte',   sub: 'Transporte público', kw: ['metro','renfe','cercanias','fgc','emt','tmc','autobus','bus '] },
    { cat: 'Transporte',   sub: 'Parking',         kw: ['parking','aparcamiento'] },
    { cat: 'Ocio',         sub: 'Streaming',       kw: ['netflix','hbo','disney','amazon prime','filmin','mubi','apple tv','dazn'] },
    { cat: 'Ocio',         sub: 'Entretenimiento', kw: ['cine','teatro','concierto','entrada','ticketmaster','vivatic'] },
    { cat: 'Suscripciones',sub: 'Software',        kw: ['chatgpt','openai','microsoft','adobe','notion','dropbox','github','slack'] },
    { cat: 'Suscripciones',sub: 'Streaming',       kw: ['spotify','apple music','youtube premium','tidal','deezer'] },
    { cat: 'Compras',      sub: 'Amazon',          kw: ['amazon'] },
    { cat: 'Compras',      sub: 'Ropa',            kw: ['zara','hm ','h&m','mango','pull&bear','bershka','stradivarius','lefties','shein'] },
    { cat: 'Salud',        sub: 'Farmacia',        kw: ['farmacia','parafarmacia','pharmacy'] },
    { cat: 'Salud',        sub: 'Gimnasio',        kw: ['gym','gimnasio','fitness','basic-fit','anytime','mcfit'] },
    { cat: 'Hogar',        sub: 'Suministros',     kw: ['endesa','iberdrola','naturgy','gas natural','aguas','canal de isabel','telefonica','vodafone','orange','movistar','masmovil'] },
    { cat: 'Viajes',       sub: 'Vuelos',          kw: ['vueling','iberia','ryanair','easyjet','air europa','wizz','norwegian'] },
    { cat: 'Viajes',       sub: 'Hoteles',         kw: ['airbnb','booking','hotel','hostal','hampton','marriott'] },
    { cat: 'Ingresos',     sub: 'Nómina',          kw: ['nomina','nómina','sueldo','salario','payroll'] },
];

let obSelectedBank = null;
let obImportedCount = 0;
let obSelectedCats = new Set(OB_SUGGESTED_CATS.map(c => c.name)); // all selected by default
let obCatsCreated = 0;
let obCatCount = 0;

function checkAndShowOnboarding() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (localStorage.getItem(`ob_done_${uid}`)) return;
    if (ALL_TRANSACTIONS.length > 0 && (DATA.current || []).length > 0) {
        localStorage.setItem(`ob_done_${uid}`, '1');
        return;
    }
    setTimeout(() => {
        obBuildBankGrid();
        document.getElementById('onboarding-overlay').classList.add('ob-visible');
        obGoStep(0);
    }, 900);
}

function obBuildBankGrid() {
    const grid = document.getElementById('ob-bank-grid');
    if (!grid) return;
    grid.innerHTML = OB_BANKS.map(code => {
        const cfg = BANK_CONFIG[code], domain = BANK_DOMAINS[code];
        const logo = domain
            ? `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" width="22" height="22" style="border-radius:5px;object-fit:contain;" onerror="this.style.display='none'">`
            : `<span style="font-size:10px;font-weight:800;color:${cfg.accent}">${cfg.initial}</span>`;
        return `<button class="ob-bank-btn" data-bank="${code}" onclick="obSelectBank('${code}')"><div class="ob-bank-logo" style="background:${cfg.color};">${logo}</div><span>${cfg.label}</span></button>`;
    }).join('');
}

function obSelectBank(code) {
    obSelectedBank = code;
    document.querySelectorAll('.ob-bank-btn').forEach(b => b.classList.toggle('ob-bank-selected', b.dataset.bank === code));
    const inst = OB_BANK_INSTRUCTIONS[code], box = document.getElementById('ob-instructions');
    if (inst && box) {
        document.getElementById('ob-inst-title').textContent = `Cómo descargar de ${BANK_CONFIG[code]?.label}`;
        document.getElementById('ob-inst-list').innerHTML = inst.steps.map(s => `<li>${s}</li>`).join('');
        document.getElementById('ob-inst-note').textContent = inst.note;
        box.style.display = 'block';
    }
    const lbl = document.getElementById('ob-upload-label');
    if (lbl) lbl.textContent = `Subir archivo de ${BANK_CONFIG[code]?.label} — haz clic aquí`;
    document.getElementById('ob-upload-area')?.classList.add('ob-upload-ready');
    const srcEl = document.getElementById('import-source');
    if (srcEl) srcEl.value = code;
}

async function obHandleImport(input) {
    if (!obSelectedBank) { alert('Selecciona primero tu banco.'); return; }
    const file = input.files[0]; if (!file) return;
    const zone = document.getElementById('ob-upload-area');
    zone.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 12a9 9 0 1 1-18 0"/></svg><span style="color:var(--accent);font-weight:600;">Procesando...</span>';
    const formData = new FormData();
    formData.append('file', file); formData.append('source', obSelectedBank);
    try {
        const r = await tokenFetch('/api/transactions/import', { method: 'POST', body: formData });
        const res = await r.json();
        if (res.imported !== undefined) {
            obImportedCount += res.imported;
            const statusEl = document.getElementById('ob-import-status'), countEl = document.getElementById('ob-import-count');
            if (statusEl) statusEl.style.display = 'flex';
            if (countEl) countEl.textContent = `${obImportedCount} transacciones importadas correctamente`;
            zone.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--green)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span style="color:var(--green);font-weight:600;">¡Listo! Puedes subir otro banco también</span>`;
            fetchTransactions();
        } else {
            zone.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--red)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><span style="color:var(--red);">Error al importar. Intenta de nuevo.</span>`;
        }
    } catch(e) {
        zone.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--red)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><span style="color:var(--red);">Error de conexión. Intenta de nuevo.</span>`;
    }
    input.value = '';
}

// ── Categories (panel 2) ──────────────────────────────────────────────────────
function obRenderCategories() {
    const grid = document.getElementById('ob-cat-grid');
    if (!grid) return;
    obSelectedCats = new Set(OB_SUGGESTED_CATS.map(c => c.name)); // reset to all selected
    obUpdateCatCount();
    grid.innerHTML = OB_SUGGESTED_CATS.map(cat => {
        const subPreview = cat.subcats.slice(0, 3).join(', ') + '…';
        return `<button class="ob-cat-card ob-cat-selected" data-cat="${cat.name}" onclick="obToggleCat('${cat.name.replace(/'/g,"\\'")}')">
            <div class="ob-cat-check"></div>
            <div class="ob-cat-emoji">${cat.emoji}</div>
            <div class="ob-cat-body">
                <div class="ob-cat-name">${cat.name}</div>
                <div class="ob-cat-subcats">${subPreview}</div>
            </div>
        </button>`;
    }).join('');
}

function obToggleCat(name) {
    if (obSelectedCats.has(name)) obSelectedCats.delete(name);
    else obSelectedCats.add(name);
    document.querySelectorAll('.ob-cat-card').forEach(el => {
        el.classList.toggle('ob-cat-selected', obSelectedCats.has(el.dataset.cat));
    });
    obUpdateCatCount();
}

function obToggleAllCats() {
    const allSelected = obSelectedCats.size === OB_SUGGESTED_CATS.length;
    obSelectedCats = allSelected ? new Set() : new Set(OB_SUGGESTED_CATS.map(c => c.name));
    document.querySelectorAll('.ob-cat-card').forEach(el => el.classList.toggle('ob-cat-selected', !allSelected));
    obUpdateCatCount();
}

function obUpdateCatCount() {
    const el = document.getElementById('ob-cat-count');
    if (el) el.textContent = `${obSelectedCats.size} de ${OB_SUGGESTED_CATS.length} categorías seleccionadas`;
}

async function obCreateCategories() {
    const btn = document.getElementById('ob-btn-create-cats');
    if (btn) { btn.disabled = true; btn.textContent = 'Creando...'; }
    const toCreate = OB_SUGGESTED_CATS.filter(c => obSelectedCats.has(c.name));
    let created = 0;
    for (const cat of toCreate) {
        try {
            const r = await tokenFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: cat.name, color: cat.color }) });
            const res = await r.json();
            const catId = res.id;
            if (catId) {
                for (const sub of cat.subcats) {
                    await tokenFetch('/api/subcategories', { method: 'POST', body: JSON.stringify({ name: sub, category_id: catId }) });
                }
                created++;
            }
        } catch(e) { /* continue */ }
    }
    obCatsCreated = created;
    obCatCount = created;
    await fetchCategoriesCache();
    const ok = document.getElementById('ob-cats-ok'), okTxt = document.getElementById('ob-cats-ok-txt');
    if (ok) ok.style.display = 'flex';
    if (okTxt) okTxt.textContent = `${created} categorías creadas con subcategorías`;
    if (btn) { btn.disabled = false; btn.textContent = 'Continuar →'; btn.onclick = () => obGoStep(3); }
}

// ── Categorize transactions (panel 3) ─────────────────────────────────────────
async function obRenderCategorize() {
    const list = document.getElementById('ob-tx-list');
    if (!list) return;
    // Refresh categories in case step 2 just created them
    if (CATEGORIES_CACHE.length === 0) await fetchCategoriesCache();
    const uncategorized = ALL_TRANSACTIONS.filter(t => !t.category || t.category === '').slice(0, 20);
    if (!uncategorized.length) {
        list.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3);font-size:13px;">
            ${ALL_TRANSACTIONS.length > 0
                ? '<span style="color:var(--green);font-weight:600;">✓ ¡Todas las transacciones están categorizadas!</span>'
                : '<div>Todavía no has importado transacciones.<br><span style="font-size:11px;">Vuelve al paso anterior o importa desde la pestaña Transacciones más tarde.</span></div>'}
        </div>`;
        return;
    }
    const catOptions = CATEGORIES_CACHE.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    if (!catOptions) {
        list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-3);font-size:12px;">Sin categorías disponibles — créalas en el paso anterior o más tarde desde Gestionar Categorías.</div>`;
        return;
    }
    list.innerHTML = uncategorized.map(t => {
        const isNeg = t.amount < 0;
        return `<div class="ob-tx-row" id="ob-tx-${t.id}" data-id="${t.id}" data-desc="${(t.description||'').toLowerCase().replace(/"/g,'&quot;')}">
            <div class="ob-tx-amt ${isNeg?'neg':'pos'}">${eur(t.amount)}</div>
            <div class="ob-tx-desc-wrap">
                <div class="ob-tx-desc">${t.description}</div>
                <div class="ob-tx-date">${t.date}</div>
            </div>
            <select class="ob-tx-cat-sel" onchange="obSaveTxCategory('${t.id}',this.value)">
                <option value="">Sin categoría</option>
                ${catOptions}
            </select>
        </div>`;
    }).join('');
}

async function obSaveTxCategory(id, catName) {
    if (!catName) return;
    const cat = CATEGORIES_CACHE.find(c => c.name === catName);
    await tokenFetch(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ category: catName, category_id: cat?.id || '', is_reviewed: true }) });
    document.getElementById(`ob-tx-${id}`)?.classList.add('ob-tx-done');
}

async function obAutoCategorize() {
    const btn = document.getElementById('ob-autocat-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Categorizando...'; }
    const rows = document.querySelectorAll('.ob-tx-row');
    let count = 0;
    const promises = [];
    rows.forEach(row => {
        const id = row.dataset.id, desc = row.dataset.desc || '';
        for (const rule of OB_AUTOCAT_RULES) {
            if (rule.kw.some(kw => desc.includes(kw))) {
                const cat = CATEGORIES_CACHE.find(c => c.name === rule.cat);
                if (!cat) continue;
                const sub = cat.subcategories?.find(s => s.name === rule.sub);
                promises.push(
                    tokenFetch(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify({ category: rule.cat, category_id: cat.id, subcategory: rule.sub, subcategory_id: sub?.id || '', is_reviewed: true }) })
                    .then(() => {
                        const sel = row.querySelector('.ob-tx-cat-sel');
                        if (sel) sel.value = rule.cat;
                        row.classList.add('ob-tx-done');
                        count++;
                    })
                );
                break;
            }
        }
    });
    await Promise.all(promises);
    fetchTransactions();
    if (btn) { btn.disabled = false; btn.textContent = `✓ ${count} transacciones categorizadas automáticamente`; }
}

// ── Assets (panel 4) ──────────────────────────────────────────────────────────
const OB_BANK_META = {
    SANTANDER:     { name: 'Santander',     emoji: '🏦' },
    REVOLUT:       { name: 'Revolut',       emoji: '💳' },
    EDENRED:       { name: 'Edenred',       emoji: '🎴' },
    BBVA:          { name: 'BBVA',          emoji: '🏦' },
    CAIXABANK:     { name: 'CaixaBank',     emoji: '🏦' },
    SABADELL:      { name: 'Sabadell',      emoji: '🏦' },
    ING:           { name: 'ING',           emoji: '🏦' },
    BANKINTER:     { name: 'Bankinter',     emoji: '🏦' },
    OPENBANK:      { name: 'Openbank',      emoji: '🏦' },
    N26:           { name: 'N26',           emoji: '💳' },
    WISE:          { name: 'Wise',          emoji: '💸' },
    ABANCA:        { name: 'Abanca',        emoji: '🏦' },
    KUTXABANK:     { name: 'Kutxabank',     emoji: '🏦' },
    UNICAJA:       { name: 'Unicaja',       emoji: '🏦' },
    IBERCAJA:      { name: 'Ibercaja',      emoji: '🏦' },
    CAJAMAR:       { name: 'Cajamar',       emoji: '🏦' },
    EVOBANK:       { name: 'EVO Banco',     emoji: '🏦' },
    MYINVESTOR:    { name: 'MyInvestor',    emoji: '📊' },
    TRADEREPUBLIC: { name: 'Trade Republic',emoji: '📈' },
};

function _obUpdateAssetStatus() {
    if (allConfigs.length > 0) {
        const el = document.getElementById('ob-assets-status');
        if (el) el.style.display = 'flex';
        const cnt = document.getElementById('ob-assets-count');
        if (cnt) cnt.textContent = `${allConfigs.length} activo${allConfigs.length !== 1 ? 's' : ''} añadido${allConfigs.length !== 1 ? 's' : ''}`;
    }
}

function obAddAssetType(type) {
    window._obAssetCallback = _obUpdateAssetStatus;
    openAssetManager();
    setTimeout(() => { switchTab('add'); setSubtype(type); }, 60);
}

function obAddBankAccount(source) {
    const meta = OB_BANK_META[source] || { name: source };
    window._obAssetCallback = _obUpdateAssetStatus;
    openAssetManager();
    setTimeout(() => {
        switchTab('add');
        setSubtype('cash');
        const nameInput = document.getElementById('asset-name');
        if (nameInput) nameInput.value = meta.name;
        const syncMode = document.getElementById('cash-sync-mode');
        if (syncMode) { syncMode.value = 'auto'; toggleCashSync(); }
        const bankSrc = document.getElementById('cash-bank-source');
        if (bankSrc) {
            const opt = Array.from(bankSrc.options).find(o => o.value === source);
            if (opt) bankSrc.value = source;
        }
    }, 80);
}

function obRenderPortfolioStep() {
    const container = document.getElementById('ob-portfolio-content');
    if (!container) return;
    const detectedSources = [...new Set(ALL_TRANSACTIONS.map(t => t.source).filter(Boolean))];
    let html = '';
    if (detectedSources.length > 0) {
        html += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--accent);margin-bottom:8px;">Cuentas detectadas — añade el saldo actual</div>`;
        html += `<div class="ob-asset-grid" style="margin-bottom:16px;">`;
        detectedSources.forEach(src => {
            const m = OB_BANK_META[src] || { name: src, emoji: '🏦' };
            html += `<div class="ob-asset-card" onclick="obAddBankAccount('${src}')">
                <div class="ob-asset-emoji">${m.emoji}</div>
                <div class="ob-asset-name">${m.name}</div>
                <div class="ob-asset-hint">Cuenta bancaria</div>
            </div>`;
        });
        html += `</div>`;
        html += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-3);margin-bottom:8px;">Otras inversiones</div>`;
    }
    html += `<div class="ob-asset-grid">
        <div class="ob-asset-card" onclick="obAddAssetType('market')"><div class="ob-asset-emoji">📈</div><div class="ob-asset-name">ETFs / Acciones</div><div class="ob-asset-hint">Precio automático</div></div>
        <div class="ob-asset-card" onclick="obAddAssetType('market')"><div class="ob-asset-emoji">₿</div><div class="ob-asset-name">Crypto</div><div class="ob-asset-hint">Tiempo real</div></div>
        <div class="ob-asset-card" onclick="obAddAssetType('indexa')"><div class="ob-asset-emoji">🤖</div><div class="ob-asset-name">Indexa Capital</div><div class="ob-asset-hint">Sync API</div></div>
        <div class="ob-asset-card" onclick="obAddAssetType('market')"><div class="ob-asset-emoji">📊</div><div class="ob-asset-name">Fondos</div><div class="ob-asset-hint">Gestoras</div></div>
        ${detectedSources.length === 0 ? `<div class="ob-asset-card" onclick="obAddAssetType('cash')"><div class="ob-asset-emoji">💰</div><div class="ob-asset-name">Efectivo</div><div class="ob-asset-hint">Cuentas bancarias</div></div>` : ''}
    </div>`;
    container.innerHTML = html;
}

// ── Navigation & Summary ──────────────────────────────────────────────────────
function obGoStep(n) {
    document.querySelectorAll('.ob-panel').forEach((el, i) => { el.style.display = i === n ? 'block' : 'none'; });
    const progress = document.getElementById('ob-progress');
    if (progress) progress.style.display = n === 0 ? 'none' : 'flex';

    if (n === 5) {
        document.querySelectorAll('.ob-prog-dot').forEach(d => { d.classList.remove('ob-active'); d.classList.add('ob-done'); });
        document.querySelectorAll('.ob-prog-line').forEach(l => l.classList.add('ob-done'));
        obBuildSummary(); return;
    }
    // dot 0=panel1, dot 1=panels2+3, dot 2=panel4
    const activeDot = { 1: 0, 2: 1, 3: 1, 4: 2 }[n];
    [0, 1, 2, 3].forEach(i => {
        const dot = document.getElementById(`ob-pdot-${i}`), line = document.getElementById(`ob-pline-${i}`);
        if (!dot) return;
        dot.classList.toggle('ob-active', i === activeDot);
        dot.classList.toggle('ob-done', activeDot !== undefined && i < activeDot);
        if (line) line.classList.toggle('ob-done', activeDot !== undefined && i < activeDot);
    });
    if (n === 2) obRenderCategories();
    if (n === 3) obRenderCategorize();
    if (n === 4) obRenderPortfolioStep();
}

function obBuildSummary() {
    const sum = document.getElementById('ob-summary'); if (!sum) return;
    const txCount = obImportedCount || ALL_TRANSACTIONS.length;
    const catCount = obCatCount || CATEGORIES_CACHE.length;
    const catTx = ALL_TRANSACTIONS.filter(t => t.category && t.category !== '').length;
    const assetCount = allConfigs.length || (DATA.current || []).length;
    const ok = (txt) => `<div class="ob-sum-item ob-sum-ok"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>${txt}</span></div>`;
    const skip = (txt) => `<div class="ob-sum-item ob-sum-skip"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg><span>${txt}</span></div>`;
    sum.innerHTML = [
        txCount > 0 ? ok(`${txCount} transacciones importadas`) : skip('Sin transacciones — impórtalas desde Transacciones'),
        catCount > 0 ? ok(`${catCount} categorías configuradas`) : skip('Sin categorías — créalas desde Gestionar Categorías'),
        catTx > 0 ? ok(`${catTx} movimientos categorizados`) : skip('Sin categorizar — hazlo desde la pestaña Transacciones'),
        assetCount > 0 ? ok(`${assetCount} activo${assetCount !== 1?'s':''} en portfolio`) : skip('Sin activos — añádelos desde Gestionar Activos'),
    ].join('');
}

function obClose() {
    const uid = auth.currentUser?.uid;
    if (uid) localStorage.setItem(`ob_done_${uid}`, '1');
    const overlay = document.getElementById('onboarding-overlay');
    overlay.style.opacity = '0'; overlay.style.transition = 'opacity 0.3s ease';
    setTimeout(() => { overlay.classList.remove('ob-visible'); overlay.style.opacity = ''; overlay.style.transition = ''; }, 300);
}

auth.onAuthStateChanged(user => { if (user) { init(); } else { window.location.href = '/'; } });