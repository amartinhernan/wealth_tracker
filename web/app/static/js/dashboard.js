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
let financeChart = null, retirementChart = null;
let draggedTransactionId = null;

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
    safeRender('Table', renderTable);
    initToggles(); initPills(); initSort();
    showPage('dashboard');
    generatePortfolioInsight();
}

function showPage(page) {
    ['dashboard', 'transactions', 'finanzas', 'retirement'].forEach(p => {
        const el = document.getElementById(`page-${p}`);
        if (el) el.style.display = p === page ? 'block' : 'none';
    });
    document.querySelectorAll('.nav-item').forEach(i => {
        i.classList.toggle('active', i.id === `nav-${page}`);
        i.style.color = '';
    });
    if (page === 'transactions') fetchTransactions();
    if (page === 'finanzas') loadFinanceData();
    if (page === 'retirement') loadRetirementData();
}

async function generatePortfolioInsight() {
    const s = DATA?.summary;
    if (!s) return;
    const portfolioSummary = JSON.stringify({
        totalValue: s.total_money, totalProfit: s.total_profit, totalInvested: s.total_invested,
        twr: s.global_twr, mwr: s.global_mwr, distribution: DATA.portfolios_grouped
    });

    try {
        const res = await tokenFetch('/api/portfolio/analysis', { method: 'POST', body: JSON.stringify({ portfolio: portfolioSummary }) });
        const parsed = await res.json();
        document.getElementById('ai-portfolio-text').textContent = parsed.summary;
        document.getElementById('ai-portfolio-items').innerHTML = parsed.items.map(i => `
                  <div class="ai-item"><div class="ai-item-icon" style="background:rgba(37,99,235,0.08)">${i.icon}</div><span>${i.text}</span></div>`).join('');
    } catch (e) { }
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

function getMonthly() {
    const { dates } = DATA.history_global, p = DATA.history_portfolios;
    const active = ['CASH', 'CRYPTO', 'FUNDS', 'ETFS'].filter(k => activePorts.has(k));
    const tot = dates.map((_, i) => active.reduce((sum, k) => sum + (p[k][i] || 0), 0));
    const lastValByMo = {};
    dates.forEach((d, i) => { lastValByMo[d.slice(0, 7)] = tot[i]; });
    const recorded = Object.keys(lastValByMo).sort();
    if (!recorded.length) return [];
    const all = []; all.push({ m: recorded[0], v: 0 });
    for (let i = 1; i < recorded.length; i++) {
        const mP = recorded[i - 1], mC = recorded[i], vP = lastValByMo[mP], vC = lastValByMo[mC];
        const [y1, n1] = mP.split('-').map(Number), [y2, n2] = mC.split('-').map(Number);
        const diff = (y2 * 12 + n2) - (y1 * 12 + n1), avg = Math.round((vC - vP) / diff);
        let ty = y1, tm = n1;
        for (let j = 0; j < diff; j++) { tm++; if (tm > 12) { tm = 1; ty++; } all.push({ m: `${ty}-${String(tm).padStart(2, '0')}`, v: avg }); }
    }
    return all;
}
function renderMonthly(cid = 'monthlyChart') {
    const all = getMonthly(); if (!all.length) return;
    const data = all.slice(1).slice(-18);
    const lbls = data.map(d => { const [y, n] = d.m.split('-'); return new Date(+y, +n - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }); });
    const vals = data.map(d => d.v);
    const ctx = document.getElementById(cid)?.getContext('2d'); if (!ctx) return; if (charts[cid]) charts[cid].destroy();
    charts[cid] = new Chart(ctx, { type: 'bar', data: { labels: lbls, datasets: [{ data: vals, backgroundColor: vals.map(v => v >= 0 ? 'rgba(21,128,61,.65)' : 'rgba(220,38,38,.65)'), borderRadius: 4, borderSkipped: false }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0E0D0B', callbacks: { label: c => ` ${c.parsed.y >= 0 ? '+' : ''}${eur(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, maxRotation: 40, autoSkip: false } }, y: { grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, callback: v => eur(v) } } } } });
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
function initToggles() { document.querySelectorAll('.ptog').forEach(el => { el.addEventListener('click', () => { const p = el.dataset.p; if (activePorts.has(p)) { if (activePorts.size > 1) activePorts.delete(p); } else { activePorts.add(p); } document.querySelectorAll(`.ptog[data-p="${p}"]`).forEach(btn => btn.classList.toggle('active', activePorts.has(p))); renderTrend(); renderMonthly(); }); }); }
function initPills() { document.querySelectorAll('.pill[data-r]').forEach(b => { b.addEventListener('click', () => { document.querySelectorAll('.pill[data-r]').forEach(x => x.classList.remove('active')); b.classList.add('active'); tRange = b.dataset.r; renderTrend(); }); }); }

// ════════════════════════════════════════════════════════════
// TRANSACTIONS
// ════════════════════════════════════════════════════════════
let txSearchTimeout;
function debouncedRenderTransactions() { clearTimeout(txSearchTimeout); txSearchTimeout = setTimeout(renderTransactionsTable, 300); }

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
    row.innerHTML = `<div class="tx-date-col" style="padding-left:0">${t.date}</div><div class="tx-source-col"><span class="src-badge src-${t.source.toLowerCase()}">${t.source}</span></div><div class="tx-desc-col"><div class="tx-desc-main" style="display:inline-flex;align-items:center;gap:6px">${t.description}<button class="btn-icon-soft" onclick="event.stopPropagation(); renameTransaction('${t.id}', '${t.description.replace(/'/g, "\\'")}')" title="Renombrar"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button></div></div><div class="tx-amount-col ${amtClass}" style="opacity:0.8">${eur(t.amount)}</div><div class="tx-cat-col" style="position:relative">${buildCatPillHTML(t)}<div id="popover-${t.id}" class="cat-popover" onclick="event.stopPropagation()"></div></div><div class="tx-status-col"><span class="${t.is_reviewed ? 'status-ok' : 'status-ia'}" onclick="toggleReviewed('${t.id}',${!t.is_reviewed})">${t.is_reviewed ? '✓ OK' : 'IA'}</span></div><div class="tx-actions-col" style="gap:4px"><button class="btn-icon-soft" style="opacity:0.4;color:var(--crypto)" onclick="openSubModal('${t.id}', '${t.description.replace(/'/g, "\\'")}', ${Math.abs(t.amount)})" title="Marcar como Suscripción"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>${t.linked_transaction_id ? `<button class="btn-del" onclick="unlinkTransaction('${t.id}')" title="Desvincular" style="opacity:0.4;color:var(--accent)"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>` : ''}<button class="btn-del" onclick="deleteTransaction('${t.id}')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></div>`;
    const catPill = row.querySelector('.cat-pill'); if (catPill) catPill.addEventListener('click', e => { e.stopPropagation(); toggleCategoryPopover(e, t.id); });
    row.addEventListener('dragstart', e => { draggedTransactionId = t.id; row.style.opacity = '.4'; e.dataTransfer.setData('text/plain', t.id); if (t.linked_transaction_id) document.getElementById('unlink-zone').classList.add('visible'); });
    row.addEventListener('dragend', () => { row.style.opacity = '1'; document.getElementById('unlink-zone').classList.remove('visible'); });
    return row;
}

function buildTxRow(t) {
    const row = document.createElement('div'); row.className = 'tx-row'; row.setAttribute('draggable', 'true'); row.dataset.id = t.id;
    const amtClass = t.category === 'Movimientos' ? 'neutral-amount' : (t.amount >= 0 ? 'up' : 'down');
    row.innerHTML = `<div class="tx-date-col">${t.date}</div><div class="tx-source-col"><span class="src-badge src-${t.source.toLowerCase()}">${t.source}</span></div><div class="tx-desc-col"><div class="tx-desc-main" style="display:inline-flex;align-items:center;gap:6px">${t.description}<button class="btn-icon-soft" onclick="event.stopPropagation(); renameTransaction('${t.id}', '${t.description.replace(/'/g, "\\'")}')" title="Renombrar"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button></div>${t.subcategory ? `<div class="tx-desc-sub">${t.subcategory}</div>` : ''}</div><div class="tx-amount-col ${amtClass}">${eur(t.amount)}</div><div class="tx-cat-col" style="position:relative">${buildCatPillHTML(t)}<div id="popover-${t.id}" class="cat-popover" onclick="event.stopPropagation()"></div></div><div class="tx-status-col"><span class="${t.is_reviewed ? 'status-ok' : 'status-ia'}" onclick="toggleReviewed('${t.id}',${!t.is_reviewed})">${t.is_reviewed ? '✓ OK' : 'IA'}</span></div><div class="tx-actions-col" style="gap:4px"><button class="btn-icon-soft" style="opacity:0.4;color:var(--crypto)" onclick="openSubModal('${t.id}', '${t.description.replace(/'/g, "\\'")}', ${Math.abs(t.amount)})" title="Añadir a Suscripciones"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button><button class="btn-del" onclick="deleteTransaction('${t.id}')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></div>`;
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

// ════════════════════════════════════════════════════════════
// FINANZAS INTELIGENCIA & SUBSCRIPCIONES
// ════════════════════════════════════════════════════════════
async function loadFinanceData() {
    try {
        const [rTx, rSub] = await Promise.all([
            tokenFetch('/api/transactions'),
            tokenFetch('/api/subscriptions')
        ]);
        const allTx = await rTx.json();
        SERVER_SUBSCRIPTIONS = rSub.ok ? await rSub.json() : [];

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

        // Subscriptions Logic
        const hiddenSubs = JSON.parse(localStorage.getItem('hidden_subs') || '[]');
        const manualSignatures = SERVER_SUBSCRIPTIONS.map(s => s.name.substring(0, 12).toLowerCase());

        const aiSubs = Object.values(recurringMap).filter(v => v.count >= 2).filter(ai => {
            const sig = ai.desc.substring(0, 12).toLowerCase();
            return !hiddenSubs.includes(sig) && !manualSignatures.some(m => sig.includes(m) || m.includes(sig));
        }).sort((a, b) => b.amt - a.amt);

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

        renderRule503020(catData);
        generateFinanceInsights(runway, saveRate, avgSave, lastBal);
        applyFinanceFilters(); // Dibuja el gráfico, top gastos y desglose de ingresos sincronizados
        renderSubscriptionsManager(SERVER_SUBSCRIPTIONS, aiSubs);

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

    const ds = [];
    if (typeF === 'ALL' || typeF === 'NET') ds.push({ type: 'line', label: 'Ahorro Neto', data: nets, borderColor: '#2563EB', backgroundColor: '#2563EB', borderWidth: 2, pointRadius: 2, tension: 0.3 });
    if (typeF === 'ALL' || typeF === 'INC') ds.push({ type: 'bar', label: 'Ingresos', data: incs, backgroundColor: 'rgba(21,128,61,0.65)', borderRadius: 4 });
    if (typeF === 'ALL' || typeF === 'EXP') ds.push({ type: 'bar', label: 'Gastos', data: exps, backgroundColor: 'rgba(220,38,38,0.65)', borderRadius: 4 });

    const ctx = document.getElementById('financeChart')?.getContext('2d');
    if (ctx) {
        if (financeChart) financeChart.destroy();
        financeChart = new Chart(ctx, {
            data: { labels: lbls.map(m => { const [y, n] = m.split('-'); return new Date(+y, +n - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }); }), datasets: ds },
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => eur(v) }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } }, x: { grid: { display: false }, border: { display: false } } } }
        });
    }

    // Actualizar Desglose de Ingresos y Top Categorías en base al tiempo seleccionado
    renderIncomesBreakdown(filtered);

    const catTotals = {};
    filtered.forEach(t => {
        if (t.amount < 0) {
            const catName = t.category || 'Sin categoría';
            catTotals[catName] = (catTotals[catName] || 0) + Math.abs(t.amount);
        }
    });
    renderTopCategories(catTotals);
}

// --- INCOMES BREAKDOWN ---
function renderIncomesBreakdown(txs) {
    let incTotal = 0; const groups = {};

    txs.forEach(t => {
        if (t.amount <= 0) return; // Solo montos positivos (ingresos)
        const name = t.category || 'Otros Ingresos';
        groups[name] = (groups[name] || 0) + t.amount;
        incTotal += t.amount;
    });

    if (document.getElementById('f-income-total')) document.getElementById('f-income-total').textContent = eur(incTotal);
    const el = document.getElementById('income-breakdown-list');
    if (!el) return;
    if (incTotal === 0) { el.innerHTML = '<p style="color:var(--text-3); font-size:12px; text-align:center; padding:10px;">No se encontraron ingresos en este periodo.</p>'; return; }

    el.innerHTML = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([name, val]) => `
                <div class="inc-row">
                    <span style="color:var(--text-2); font-weight:500">${name}</span>
                    <span style="font-family:'JetBrains Mono',monospace; font-weight:600; color:var(--green)">+${eur(val)}</span>
                </div>
            `).join('');
}

// --- SUBSCRIPTIONS ---
function openSubModal(txId, name, amount) {
    document.getElementById('sub-form-id').value = '';
    document.getElementById('sub-form-name').value = name || '';
    document.getElementById('sub-form-amt').value = amount || '';
    document.getElementById('sub-form-day').value = new Date().getDate();
    document.getElementById('sub-form-freq').value = 'mensual';
    document.getElementById('modal-sub-manager').classList.add('open');
}

async function saveManualSubscription() {
    const id = document.getElementById('sub-form-id').value;
    const data = {
        id: id || null,
        name: document.getElementById('sub-form-name').value,
        amount: document.getElementById('sub-form-amt').value,
        frequency: document.getElementById('sub-form-freq').value,
        dayOfMonth: document.getElementById('sub-form-day').value
    };
    if (!data.name || !data.amount) return;
    await tokenFetch('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) });
    document.getElementById('modal-sub-manager').classList.remove('open');
    loadFinanceData();
}

async function deleteSubscription(id) {
    if (!confirm('¿Eliminar esta suscripción?')) return;
    await tokenFetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
    loadFinanceData();
}

function hideAISubscription(signature) {
    const hidden = JSON.parse(localStorage.getItem('hidden_subs') || '[]');
    hidden.push(signature.substring(0, 12).toLowerCase());
    localStorage.setItem('hidden_subs', JSON.stringify(hidden));
    loadFinanceData();
}

function renderSubscriptionsManager(manual, ai) {
    // Calendar
    const cal = document.getElementById('sub-calendar');
    if (cal) {
        let calHtml = '';
        for (let i = 1; i <= 31; i++) {
            const subsOnDay = manual.filter(s => s.dayOfMonth == i);
            const hasSub = subsOnDay.length > 0;
            calHtml += `<div class="cal-day ${hasSub ? 'has-sub' : ''}" title="${hasSub ? subsOnDay.map(s => s.name).join(', ') : ''}">${i}${hasSub ? '<div class="cal-dot"></div>' : ''}</div>`;
        }
        cal.innerHTML = calHtml;
    }

    // Manual List
    const manualEl = document.getElementById('subs-manual-list');
    let totalManual = 0;
    if (manualEl) {
        manualEl.innerHTML = manual.length ? manual.map(s => {
            const amt = s.frequency === 'anual' ? s.amount / 12 : s.frequency === 'trimestral' ? s.amount / 3 : s.amount;
            totalManual += amt;
            return `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--surface); border:1px solid var(--border); padding:10px 12px; border-radius:8px;">
                        <div>
                            <div style="font-size:12.5px; font-weight:600">${s.name}</div>
                            <div style="font-size:10px; color:var(--text-3); text-transform:uppercase; margin-top:2px;">Día ${s.dayOfMonth} · ${s.frequency || 'Mensual'}</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <span style="font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--red)">${eur(-s.amount)}</span>
                            <button class="sub-action-btn" onclick="deleteSubscription('${s.id}')" style="color:var(--red)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
                        </div>
                    </div>`;
        }).join('') : '<div style="font-size:12px;color:var(--text-3);text-align:center;padding:10px;">Ninguna suscripción manual configurada.</div>';
        if (document.getElementById('f-sub-total')) document.getElementById('f-sub-total').textContent = eur(-totalManual) + '/mes';
    }

    // AI List
    const aiEl = document.getElementById('subs-ai-list');
    if (aiEl) {
        aiEl.innerHTML = ai.length ? ai.slice(0, 5).map(s => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg2); padding:10px 12px; border-radius:8px;">
                        <div>
                            <div style="font-size:12.5px; font-weight:500; color:var(--text-2)">${s.desc}</div>
                            <div style="font-size:10.5px; color:var(--text-3)">Detectado ${s.count} veces</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-family:'JetBrains Mono',monospace; font-weight:600; color:var(--text); margin-right:4px;">${eur(-s.amt)}</span>
                            <button class="sub-action-btn" onclick="openSubModal(null, '${s.desc.replace(/'/g, "\\'")}', ${s.amt})" style="color:var(--green)" title="Confirmar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg></button>
                            <button class="sub-action-btn" onclick="hideAISubscription('${s.desc.replace(/'/g, "\\'")}')" style="color:var(--text-3)" title="Descartar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                        </div>
                    </div>`).join('') : '<div style="font-size:12px;color:var(--text-3);text-align:center;padding:10px;">No hay sugerencias pendientes.</div>';
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
    const insights = [];

    if (runway < 3) insights.push({ icon: '⚠️', color: 'var(--red)', text: `Prioriza acumular 6 meses de gastos líquidos. Tienes solo ${runway.toFixed(1)} meses.` });
    else if (runway < 6) insights.push({ icon: '🛡️', color: '#D97706', text: `Runway de ${runway.toFixed(1)} meses. Considera aumentarlo antes de ser agresivo invirtiendo.` });
    else insights.push({ icon: '✅', color: 'var(--green)', text: `Colchón saludable (${runway.toFixed(1)} meses). Puedes destinar el excedente a inversión.` });

    if (saveRate > 25) insights.push({ icon: '🚀', color: 'var(--green)', text: `Ahorras el ${saveRate.toFixed(1)}% de tus ingresos. Patrón excelente para acelerar multiversos.` });
    else if (saveRate > 0) insights.push({ icon: '📈', color: 'var(--accent)', text: `Tasa de ahorro del ${saveRate.toFixed(1)}%. Intenta reducir la partida de Deseos un 5% el próximo mes.` });
    else insights.push({ icon: '🔴', color: 'var(--red)', text: `Déficit detectado. Necesitas un recorte agresivo en gastos no esenciales.` });

    if (lastBal && avgSave) {
        const trend = lastBal > avgSave ? 'Mejor' : 'Peor';
        insights.push({ icon: lastBal > avgSave ? '📉' : '📈', color: lastBal > avgSave ? 'var(--green)' : '#D97706', text: `Último mes cerrado (${eur(lastBal)}), ${trend} que tu media anual (${eur(avgSave)}).` });
    }

    if (list) list.innerHTML = insights.map(i => `
                <div style="display:flex; gap:10px; align-items:flex-start; background:var(--surface); padding:10px; border-radius:8px; border:1px solid var(--border);">
                    <div style="font-size:16px;">${i.icon}</div>
                    <div style="font-size:12px; color:var(--text-2); line-height:1.4;">${i.text}</div>
                </div>`).join('');
}

function renderTopCategories(catTotals) {
    const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = sorted[0]?.[1] || 1;
    const catColors = ['#2563EB', '#7C3AED', '#0891B2', '#059669', '#D97706', '#DC2626'];
    const el = document.getElementById('top-cats-list');
    if (el) el.innerHTML = sorted.map(([name, val], i) => `
                <div style="margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 600; margin-bottom: 6px;">
                        <span style="color: var(--text);">${name}</span>
                        <span style="font-family: 'JetBrains Mono', monospace; color: var(--red);">${eur(-val)}</span>
                    </div>
                    <div style="height: 6px; background: var(--bg2); border-radius: 3px; overflow: hidden;">
                        <div style="height: 100%; border-radius: 3px; width: ${(val / max * 100).toFixed(0)}%; background: ${catColors[i % catColors.length]};"></div>
                    </div>
                </div>`).join('');
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
function closeAssetManager() { document.getElementById('modal-manage').classList.remove('open'); }
function switchTab(tab) { document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-btn-${tab}`)); document.getElementById('tab-list').style.display = tab === 'list' ? 'block' : 'none'; document.getElementById('tab-add').style.display = tab === 'add' ? 'block' : 'none'; if (tab === 'add') { document.getElementById('asset-form').reset(); document.getElementById('asset-id').value = ''; document.getElementById('btn-save-asset').textContent = 'Guardar Activo'; setSubtype('cash'); } }
function setFilter(f) { currentFilter = f; renderConfigList(); }
function setSubtype(st) { document.getElementById('asset-subtype').value = st;['cash', 'market', 'indexa'].forEach(b => document.getElementById(`sub-btn-${b}`).classList.toggle('active', b === st)); document.getElementById('market-fields').style.display = st === 'market' ? 'block' : 'none'; document.getElementById('ticker-group').style.display = st === 'market' ? 'block' : 'none'; document.getElementById('indexa-fields').style.display = st === 'indexa' ? 'block' : 'none'; document.getElementById('cash-fields').style.display = st === 'cash' ? 'block' : 'none'; document.getElementById('invested-group').style.display = st === 'cash' ? 'none' : 'block'; document.getElementById('asset-invested').required = st !== 'cash'; const hl = document.getElementById('holdings-label'), hh = document.getElementById('holdings-hint'), ps = document.getElementById('asset-portfolio'); if (st === 'cash') { hl.textContent = 'Saldo Total (€)'; hh.textContent = 'Valor actual en cuenta.'; ps.value = 'CASH'; ps.disabled = true; toggleCashSync(); } else if (st === 'market') { hl.textContent = 'Unidades'; hh.textContent = 'Número de títulos.'; document.getElementById('asset-type').value = 'auto'; ps.disabled = false; } else { hl.textContent = 'Valor Actual (€)'; hh.textContent = 'Se actualizará con el Token.'; ps.value = 'FUNDS'; ps.disabled = false; } }
function toggleCashSync() { const mode = document.getElementById('cash-sync-mode').value; document.getElementById('cash-bank-group').style.display = mode === 'auto' ? 'block' : 'none'; document.getElementById('asset-type').value = mode; }
async function fetchConfigs() { const r = await tokenFetch('/api/configs'); allConfigs = await r.json(); renderConfigList(); }
function renderConfigList() { const list = document.getElementById('asset-configs-list'), subNav = document.getElementById('sub-nav-list'); if (!list) return; const counts = { ALL: allConfigs.length, CASH: 0, FUNDS: 0, CRYPTO: 0, ETFS: 0, OTROS: 0 }; allConfigs.forEach(c => { if (counts[c.portfolio] !== undefined) counts[c.portfolio]++; else counts.OTROS++; }); const labels = { ALL: 'Todos', CASH: 'Efectivo', FUNDS: 'Fondos', CRYPTO: 'Crypto', ETFS: 'ETFs', OTROS: 'Otros' }; subNav.innerHTML = ['ALL', 'CASH', 'FUNDS', 'CRYPTO', 'ETFS', 'OTROS'].map(f => `<button class="sub-btn ${currentFilter === f ? 'active' : ''}" onclick="setFilter('${f}')">${labels[f]} ${counts[f]}</button>`).join(''); const fi = currentFilter === 'ALL' ? allConfigs : allConfigs.filter(c => c.portfolio === currentFilter || (currentFilter === 'OTROS' && !['CASH', 'FUNDS', 'CRYPTO', 'ETFS'].includes(c.portfolio))); list.innerHTML = fi.map(c => `<div class="config-item"><div><div style="font-weight:500">${c.name}</div><div style="font-size:11px;color:var(--text-3)">${c.portfolio} · ${c.subtype === 'market' ? (c.ticker || 'N/A') : c.subtype.toUpperCase()}</div></div><div style="display:flex;gap:8px"><button class="btn-action" onclick="editConfig('${c.id}')" style="padding:4px 10px;font-size:11px">Editar</button><button class="btn-action" onclick="deleteConfig('${c.id}')" style="padding:4px 10px;font-size:11px;background:rgba(220,38,38,0.06);color:var(--red);border-color:rgba(220,38,38,0.15)">Borrar</button></div></div>`).join('') || '<div style="text-align:center;color:var(--text-3);padding:32px">No hay activos en esta categoría.</div>'; }
let searchTimeoutGlobal; function onSearchInput(val) { clearTimeout(searchTimeoutGlobal); if (val.length < 2) { document.getElementById('search-results').style.display = 'none'; return; } searchTimeoutGlobal = setTimeout(async () => { const port = document.getElementById('asset-portfolio').value; const r = await tokenFetch(`/api/search?q=${val}&portfolio=${port}`); const results = await r.json(); const container = document.getElementById('search-results'); container.innerHTML = results.map(r => `<div class="search-item" onclick="selectTicker('${r.symbol}','${r.name}')"><b>${r.display_symbol || r.symbol}</b> — ${r.name} (${r.exch})</div>`).join(''); container.style.display = results.length ? 'block' : 'none'; }, 300); }
function selectTicker(symbol, name) { document.getElementById('asset-ticker').value = symbol; document.getElementById('asset-name').value = name; document.getElementById('search-results').style.display = 'none'; }
async function saveAsset() { let finalType = document.getElementById('asset-type').value || 'manual'; let finalTicker = document.getElementById('asset-ticker').value; let holdingsVal = document.getElementById('asset-holdings').value; let investedVal = document.getElementById('asset-invested').value; if (document.getElementById('asset-subtype').value === 'cash') { investedVal = holdingsVal; if (document.getElementById('cash-sync-mode').value === 'auto') { finalType = 'auto'; finalTicker = document.getElementById('cash-bank-source').value; } } const data = { id: document.getElementById('asset-id').value || null, name: document.getElementById('asset-name').value, portfolio: document.getElementById('asset-portfolio').value, subtype: document.getElementById('asset-subtype').value, type: finalType, ticker: finalTicker, holdings: holdingsVal, invested_total: investedVal }; const r = await tokenFetch('/api/configs', { method: 'POST', body: JSON.stringify(data) }); if (r.ok) { switchTab('list'); fetchConfigs(); } }
function editConfig(id) { const c = allConfigs.find(x => x.id === id); if (!c) return; let currentHoldings = c.holdings; if (DATA && DATA.portfolios_grouped) { for (const g of Object.values(DATA.portfolios_grouped)) { const found = g.assets.find(a => a.name.trim().toLowerCase() === c.name.trim().toLowerCase()); if (found) { currentHoldings = (c.subtype === 'cash') ? found.value : found.holdings; break; } } } switchTab('add'); setTimeout(() => { document.getElementById('asset-id').value = c.id; document.getElementById('asset-name').value = c.name; document.getElementById('asset-portfolio').value = c.portfolio; document.getElementById('asset-subtype').value = c.subtype; document.getElementById('asset-type').value = c.type; document.getElementById('asset-ticker').value = c.ticker || ''; document.getElementById('asset-holdings').value = currentHoldings; document.getElementById('asset-invested').value = c.invested_total; if (c.subtype === 'cash') { document.getElementById('cash-sync-mode').value = c.type === 'auto' ? 'auto' : 'manual'; if (c.type === 'auto' && c.ticker) document.getElementById('cash-bank-source').value = c.ticker; } setSubtype(c.subtype || 'market'); document.getElementById('btn-save-asset').textContent = 'Actualizar Activo'; }, 10); }
async function deleteConfig(id) { if (!confirm('¿Eliminar este activo?')) return; const r = await tokenFetch(`/api/configs/${id}`, { method: 'DELETE' }); if (r.ok) fetchConfigs(); }
async function syncIndexa() { const btn = document.getElementById('btn-sync-all'), icon = document.getElementById('sync-icon-indexa'); btn.style.opacity = '.6'; btn.style.pointerEvents = 'none'; icon.classList.add('spinning'); try { await tokenFetch('/api/sync/all', { method: 'POST' }); await init(); } catch (e) { } finally { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; icon.classList.remove('spinning'); } }

let activeVerse = 'startup'; let multiverseChart = null; let hits = JSON.parse(localStorage.getItem('wealth_hitos') || '[]');
function loadRetirementData() { if (!DATA || !DATA.summary) return; renderHitos(); updateMultiverse(); }
function fillFinancials(type) { if (!ALL_TRANSACTIONS || !ALL_TRANSACTIONS.length) return; const now = new Date(); const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(now.getMonth() - 6); const months = {}; ALL_TRANSACTIONS.forEach(t => { const d = new Date(t.date); if (d < sixMonthsAgo || t.category === 'Movimientos') return; const m = t.date.substring(0, 7); if (!months[m]) months[m] = { inc: 0, exp: 0 }; if (t.amount > 0) months[m].inc += t.amount; else months[m].exp += Math.abs(t.amount); }); const monthKeys = Object.keys(months); if (!monthKeys.length) return; const sumInc = monthKeys.reduce((s, k) => s + months[k].inc, 0); const sumExp = monthKeys.reduce((s, k) => s + months[k].exp, 0); if (type === 'income') document.getElementById('m-income').value = Math.round(sumInc / monthKeys.length); else if (type === 'expense') document.getElementById('m-spend').value = Math.round(sumExp / monthKeys.length); updateMultiverse(); }
function fillHistory(type) { if (!DATA || !DATA.history_global) return; if (type === 'roi') { const globalMwr = DATA.summary.global_mwr || 7; document.getElementById('m-roi').value = globalMwr.toFixed(1); } updateMultiverse(); }
function addHito() { const name = document.getElementById('h-name').value; const val = parseFloat(document.getElementById('h-val').value); const date = document.getElementById('h-date').value; if (!name || isNaN(val) || !date) return; hits.push({ id: Date.now(), name, val, date }); localStorage.setItem('wealth_hitos', JSON.stringify(hits)); document.getElementById('h-name').value = ''; document.getElementById('h-val').value = ''; renderHitos(); updateMultiverse(); }
function removeHito(id) { hits = hits.filter(h => h.id !== id); localStorage.setItem('wealth_hitos', JSON.stringify(hits)); renderHitos(); updateMultiverse(); }
function renderHitos() { const container = document.getElementById('hito-list'); if (!container) return; container.innerHTML = hits.sort((a, b) => a.date.localeCompare(b.date)).map(h => `<div class="hito-item"><div class="hito-info"><div class="hito-icon">${h.isMonthly ? '🔄' : '✨'}</div><div><div class="hito-name">${h.name}</div><div class="hito-date">${h.isMonthly ? 'Desde ' : ''}${h.date}</div></div></div><div style="display:flex; align-items:center; gap:12px"><span style="font-weight:700; color:var(--red)">-${eur(h.val)}${h.isMonthly ? '/mes' : ''}</span><div class="hito-remove" onclick="removeHito(${h.id})">×</div></div></div>`).join(''); }
function selectVerse(verse) { activeVerse = verse; document.querySelectorAll('.verse-card').forEach(c => c.classList.remove('active')); document.getElementById(`v-${verse}`).classList.add('active'); updateMultiverse(); }
function updateMultiverse() { const income = parseFloat(document.getElementById('m-income').value) || 0; const incG = parseFloat(document.getElementById('m-inc-growth').value) || 0; const spend = parseFloat(document.getElementById('m-spend').value) || 0; const expG = parseFloat(document.getElementById('m-exp-growth').value) || 0; const roi = parseFloat(document.getElementById('m-roi').value) || 7; const investRate = parseFloat(document.getElementById('m-invest-rate').value) || 80; const extraSave = parseFloat(document.getElementById('m-save').value) || 0; const years = parseInt(document.getElementById('m-years').value) || 20; const totalWealth = DATA?.summary?.total_money || 0; const realRoi = roi / 100; let runwayWealth = totalWealth; let monthsRunway = 0; const now = new Date(); for (let m = 1; m <= 600; m++) { const cur = new Date(now.getFullYear(), now.getMonth() + m); const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`; const curExp = spend * Math.pow(1 + (expG / 100), m / 12); const hitoTotal = hits.filter(h => !h.isMonthly && h.date === dateStr).reduce((s, h) => s + h.val, 0); const recurTotal = hits.filter(h => h.isMonthly && dateStr >= h.date).reduce((s, h) => s + h.val, 0); runwayWealth -= hitoTotal; runwayWealth -= (curExp + recurTotal); if (runwayWealth <= 0) { monthsRunway = m; break; } } document.getElementById('stat-runway').textContent = `${monthsRunway} meses`; document.getElementById('runway-bar').style.width = `${Math.min(100, (monthsRunway / 48) * 100)}%`; const monthlySWR = (totalWealth * 0.04) / 12; const checkTier = (id, cost) => { const el = document.getElementById(id); if (!el) return; if (monthlySWR >= cost) { el.textContent = 'Free'; el.className = 'tier-unlocked'; } else { el.textContent = `-${eur(cost - monthlySWR)}`; el.className = 'tier-locked'; } }; checkTier('tier-sea', 1000); checkTier('tier-ee', 1600); checkTier('tier-es', 2400); const gapFutureCost = (spend * 12) * Math.pow(1 + (roi / 100), 20); if (document.getElementById('stat-gap-cost')) document.getElementById('stat-gap-cost').textContent = eur(gapFutureCost); let compWealth = totalWealth; for (let i = 0; i < years; i++) compWealth *= (1 + realRoi); if (document.getElementById('stat-comp-final')) document.getElementById('stat-comp-final').textContent = eur(compWealth); renderMultiverseChart(totalWealth, income, incG, spend, expG, extraSave, realRoi, investRate, years); updateInsight(activeVerse, monthsRunway, monthlySWR, gapFutureCost, compWealth); }
function updateInsight(verse, runway, swr, gap, comp) { const el = document.getElementById('multiverse-insight'); if (!el) return; const insights = { startup: `En modo <b>Runway</b>, podrías sobrevivir <b>${runway} meses</b> sin ingresos. Al final, tu gasto mensual proyectado será de ${eur(parseFloat(document.getElementById('m-spend').value) * Math.pow(1 + (parseFloat(document.getElementById('m-exp-growth').value) / 100), runway / 12))}.`, nomad: `Con tu capital actual, puedes extraer con seguridad <b>${eur(swr)}/mes</b>. Esto cubriría un estilo de vida nómada básico inmediatamente.`, gap: `Un año sabático hoy tiene un coste total de oportunidad de <b>${eur(gap)}</b> en tu patrimonio futuro proyectado a 20 años.`, compound: `Si dejaras de ahorrar hoy mismo, el interés compuesto llevaría tu capital hasta los <b>${eur(comp)}</b> en el horizonte seleccionado.` }; el.innerHTML = insights[verse] || 'Selecciona un escenario para ver el impacto.'; }
function renderMultiverseChart(initial, income, incG, spend, expG, extra, roi, investRate, years) { const ctx = document.getElementById('multiverseChart')?.getContext('2d'); if (!ctx) return; if (multiverseChart) multiverseChart.destroy(); const labels = []; const dataBase = []; const dataVerse = []; let currentBase = initial; let currentVerse = initial; const now = new Date(); for (let y = 0; y <= years; y++) { labels.push(`${y}a`); for (let m = 0; m < 12; m++) { if (y === 0 && m === 0) continue; const cur = new Date(now.getFullYear(), now.getMonth() + (y * 12) + m); const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`; const hitoTotal = hits.filter(h => !h.isMonthly && h.date === dateStr).reduce((s, h) => s + h.val, 0); const recurTotal = hits.filter(h => h.isMonthly && dateStr >= h.date).reduce((s, h) => s + h.val, 0); const curInc = income * Math.pow(1 + (incG / 100), (y * 12 + m) / 12); const curExp = (spend + recurTotal) * Math.pow(1 + (expG / 100), (y * 12 + m) / 12); const curSave = (curInc - curExp) + extra; let monthlyInvested = Math.max(0, curSave * (investRate / 100)); let monthlyLiquid = curSave - monthlyInvested; currentBase = (currentBase + monthlyInvested) * (1 + (roi / 12)) + monthlyLiquid; currentBase -= hitoTotal; if (activeVerse === 'startup') { currentVerse = Math.max(0, currentVerse - (curExp + hitoTotal)); } else if (activeVerse === 'compound') { currentVerse = currentVerse * (1 + (roi / 12)) - hitoTotal; } else if (activeVerse === 'gap') { if (y === 0) currentVerse = (currentVerse - (curExp + hitoTotal)); else currentVerse = (currentVerse + monthlyInvested) * (1 + (roi / 12)) + monthlyLiquid - hitoTotal; } else { currentVerse = currentBase; } } dataBase.push(Math.round(currentBase)); dataVerse.push(Math.round(currentVerse)); } multiverseChart = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [{ label: 'Proyección Realista', data: dataBase, borderColor: 'rgba(156, 163, 175, 0.4)', borderDash: [5, 5], pointRadius: 0, fill: false, tension: 0.3 }, { label: 'Escenario Seleccionado', data: dataVerse, borderColor: '#2563EB', backgroundColor: 'rgba(37, 99, 235, 0.08)', fill: true, tension: 0.4, pointRadius: 0 }] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, position: 'top', align: 'end' }, tooltip: { backgroundColor: '#0E0D0B', callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${eur(ctx.raw)}` } } }, scales: { y: { ticks: { callback: v => eur(v), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.03)' }, border: { display: false } }, x: { grid: { display: false }, border: { display: false } } } } }); }

auth.onAuthStateChanged(user => { if (user) { init(); } else { window.location.href = '/'; } });