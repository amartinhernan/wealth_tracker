// ── Helpers ──
const eur = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const eurF = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
const pct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

// ── State ──
let DATA, activePorts = new Set(['CASH', 'CRYPTO', 'FUNDS', 'ETFS']), tRange = 'ALL';
const charts = {};
const COLORS = {
    CASH: { bg: 'rgba(107,114,128,.55)', bd: '#6B7280' },
    CRYPTO: { bg: 'rgba(124,58,237,.55)', bd: '#7C3AED' },
    FUNDS: { bg: 'rgba(8,145,178,.55)', bd: '#0891B2' },
    ETFS: { bg: 'rgba(5,150,105,.55)', bd: '#059669' },
};
const LABELS = { CASH: 'Efectivo', CRYPTO: 'Crypto', FUNDS: 'Fondos', ETFS: 'ETFs' };
const GRP_COLORS = ['#6B7280', '#7C3AED', '#0891B2', '#059669'];

// ── Init ──
async function init() {
    try {
        // Obtenemos los datos reales de tu base de datos Python
        const response = await fetch('/api/data');
        DATA = await response.json();

        if (DATA.error) {
            alert("No hay datos en la base de datos.");
            return;
        }
    } catch (error) {
        console.error("Error conectando con el servidor:", error);
        alert("Asegúrate de tener el servidor 'python app.py' ejecutándose.");
        return;
    }

    const s = DATA.summary;
    document.getElementById('date-pill').textContent = s.date;
    document.getElementById('sfoot').innerHTML = `Actualizado:<br>${s.date}`;

    // Renderizamos toda la interfaz
    renderKPIs();
    renderSparklines();
    renderTrend();
    renderDonut();
    renderMonthly();
    renderAlloc();
    renderTable();
    initToggles();
    initPills();
    initSort();
}

// ── KPIs ──
function renderKPIs() {
    const s = DATA.summary;
    const pp = s.total_invested > 0 ? (s.total_profit / s.total_invested * 100) : 0;
    set('k-total', eur(s.total_money));
    setb('k-total-b', pct(pp), pp >= 0);
    set('k-profit', eur(s.total_profit));
    setb('k-profit-b', pct(pp), s.total_profit >= 0);
    setv('k-twr', pct(s.global_twr), s.global_twr >= 0);
    setv('k-mwr', pct(s.global_mwr), s.global_mwr >= 0);
}
const set = (id, v) => document.getElementById(id).textContent = v;
const setb = (id, v, up) => { const el = document.getElementById(id); el.textContent = v; el.className = 'badge ' + (up ? 'up' : 'down'); };
const setv = (id, v, up) => { const el = document.getElementById(id); el.textContent = v; el.className = 'kpi-val ' + (up ? 'up' : 'down'); };

// ── Sparklines ──
function renderSparklines() {
    const p = DATA.history_portfolios, d = DATA.history_global;
    const tot = d.dates.map((_, i) => (p.CASH[i] || 0) + (p.CRYPTO[i] || 0) + (p.FUNDS[i] || 0) + (p.ETFS[i] || 0));
    spark('sp-total', tot, '#16A34A');
    spark('sp-profit', tot.map((v, i) => v - d.invested[i]), '#16A34A');
}

function spark(id, data, color) {
    const c = document.getElementById(id); if (!c) return;
    const w = c.offsetWidth || 90, h = c.offsetHeight || 45;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const mn = Math.min(...data), mx = Math.max(...data), rg = (mx - mn) || 1;
    ctx.beginPath();
    data.forEach((v, i) => {
        const x = (i / (data.length - 1)) * w, y = h - ((v - mn) / rg) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
}

// ── Trend chart data prep ──
function filteredData() {
    const { dates, invested } = DATA.history_global;
    const last = new Date(dates[dates.length - 1]);
    let cut = new Date('1900-01-01');
    if (tRange === '1M') { cut = new Date(last); cut.setMonth(cut.getMonth() - 1); }
    if (tRange === '3M') { cut = new Date(last); cut.setMonth(cut.getMonth() - 3); }
    if (tRange === '6M') { cut = new Date(last); cut.setMonth(cut.getMonth() - 6); }
    if (tRange === '1Y') { cut = new Date(last); cut.setFullYear(cut.getFullYear() - 1); }
    const idx = dates.reduce((a, d, i) => { if (new Date(d) >= cut) a.push(i); return a; }, []);
    const p = DATA.history_portfolios;
    return {
        labels: idx.map(i => dates[i]),
        invested: idx.map(i => invested[i]),
        CASH: idx.map(i => p.CASH[i] || 0),
        CRYPTO: idx.map(i => p.CRYPTO[i] || 0),
        FUNDS: idx.map(i => p.FUNDS[i] || 0),
        ETFS: idx.map(i => p.ETFS[i] || 0),
    };
}

function trendDatasets(fd) {
    const sets = ['CASH', 'CRYPTO', 'FUNDS', 'ETFS']
        .filter(p => activePorts.has(p))
        .map(p => ({
            label: LABELS[p], data: fd[p],
            backgroundColor: COLORS[p].bg, borderColor: COLORS[p].bd,
            borderWidth: 1.5, fill: true, tension: .4, pointRadius: 0, stack: 'p'
        }));
    sets.push({
        label: 'Capital Invertido', data: fd.invested,
        borderColor: '#111110', borderWidth: 2.5,
        borderDash: [7, 5], fill: false, tension: .4,
        pointRadius: 0, stack: 'i'
    });
    return sets;
}

function renderTrend(cid = 'trendChart') {
    const fd = filteredData();
    const ctx = document.getElementById(cid)?.getContext('2d');
    if (!ctx) return;
    if (charts[cid]) charts[cid].destroy();
    charts[cid] = new Chart(ctx, {
        type: 'line',
        data: { labels: fd.labels, datasets: trendDatasets(fd) },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111110', titleColor: '#A09E99',
                    bodyColor: '#fff', padding: 12, cornerRadius: 8,
                    callbacks: { label: c => ` ${c.dataset.label}: ${eur(c.parsed.y)}` }
                }
            },
            scales: {
                x: {
                    type: 'time', time: { tooltipFormat: 'dd MMM yyyy', displayFormats: { month: 'MMM yy', week: 'dd MMM' } },
                    grid: { display: false }, border: { display: false },
                    ticks: { color: '#A09E99', font: { size: 10, family: 'Figtree' }, maxTicksLimit: 7 }
                },
                y: {
                    stacked: true, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false },
                    ticks: { color: '#A09E99', font: { size: 10, family: 'Figtree' }, callback: v => eur(v) }
                }
            }
        }
    });
}

// ── Donut ──
function renderDonut() {
    const g = DATA.portfolios_grouped;
    const lbls = Object.keys(g), vals = lbls.map(k => g[k].total_val);
    const tot = vals.reduce((a, b) => a + b, 0);
    document.getElementById('dc-val').textContent = eur(tot);
    document.getElementById('donut-leg').innerHTML = lbls.map((l, i) => `
<div class="dleg-row">
<div class="dleg-dot" style="background:${GRP_COLORS[i]}"></div>
<span class="dleg-name">${l}</span>
<span class="dleg-val">${eur(vals[i])}</span>
<span class="dleg-pct">${tot > 0 ? (vals[i] / tot * 100).toFixed(1) : 0}%</span>
</div>`).join('');
    const ctx = document.getElementById('donutChart').getContext('2d');
    if (charts.donut) charts.donut.destroy();
    charts.donut = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: lbls, datasets: [{ data: vals, backgroundColor: GRP_COLORS, borderWidth: 0, hoverOffset: 6 }] },
        options: {
            responsive: true, maintainAspectRatio: true, cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111110', callbacks: {
                        label: c => ` ${eur(c.parsed)} (${tot > 0 ? (c.parsed / tot * 100).toFixed(1) : 0}%)`
                    }
                }
            }
        }
    });
}

// ── Monthly P&L ──
function getMonthly() {
    const { dates } = DATA.history_global, p = DATA.history_portfolios;
    const tot = dates.map((_, i) => (p.CASH[i] || 0) + (p.CRYPTO[i] || 0) + (p.FUNDS[i] || 0) + (p.ETFS[i] || 0));
    const mo = {};
    dates.forEach((d, i) => { const k = d.slice(0, 7); if (!mo[k]) mo[k] = []; mo[k].push(tot[i]); });
    return mo;
}
function renderMonthly(cid = 'monthlyChart') {
    const mo = getMonthly();
    const months = Object.keys(mo).sort().slice(-18);
    const lbls = months.map(m => { const [y, n] = m.split('-'); return new Date(+y, +n - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }); });
    const vals = months.map((m, i) => {
        const curr = mo[m][mo[m].length - 1];
        if (i === 0) return 0;
        const prev = mo[months[i - 1]][mo[months[i - 1]].length - 1];
        return Math.round(curr - prev);
    }).slice(1);
    const ctx = document.getElementById(cid)?.getContext('2d');
    if (!ctx) return;
    if (charts[cid]) charts[cid].destroy();
    charts[cid] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: lbls.slice(1),
            datasets: [{
                data: vals,
                backgroundColor: vals.map(v => v >= 0 ? 'rgba(22,163,74,.65)' : 'rgba(220,38,38,.65)'),
                borderRadius: 4, borderSkipped: false
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111110', callbacks: {
                        label: c => ` ${c.parsed.y >= 0 ? '+' : ''}${eur(c.parsed.y)}`
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, border: { display: false }, ticks: { color: '#A09E99', font: { size: 10 }, maxRotation: 40, autoSkip: false } },
                y: { grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false }, ticks: { color: '#A09E99', font: { size: 10 }, callback: v => eur(v) } }
            }
        }
    });
}

// ── Alloc bars ──
function renderAlloc() {
    const g = DATA.portfolios_grouped;
    const tot = Object.values(g).reduce((s, v) => s + v.total_val, 0);
    document.getElementById('alloc-list').innerHTML = Object.entries(g).map(([name, gr], i) => {
        const p = tot > 0 ? (gr.total_val / tot * 100) : 0;
        const profit = gr.total_val - gr.total_inv;
        const pp = gr.total_inv > 0 ? (profit / gr.total_inv * 100).toFixed(1) : 0;
        const c = GRP_COLORS[i % GRP_COLORS.length]; // Para evitar errores si hay más categorías que colores
        return `<div class="alloc-item">
<div class="alloc-row">
<div class="alloc-name">
  <div style="width:8px;height:8px;border-radius:2px;background:${c};"></div>
  ${name}
</div>
<div>
  <span class="alloc-right">${eur(gr.total_val)}</span>
  <span style="font-size:11px;margin-left:6px;color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};">${profit >= 0 ? '+' : ''}${pp}%</span>
</div>
</div>
<div class="alloc-bar"><div class="alloc-fill" style="width:${p.toFixed(1)}%;background:${c};"></div></div>
<div class="alloc-sub">${p.toFixed(1)}% del patrimonio · ${eur(gr.total_inv)} invertido</div>
</div>`;
    }).join('');
}

// ── Table ──
let sortCol = 'value', sortDir = -1;
const collapsed = {};

function renderTable() {
    const g = DATA.portfolios_grouped;
    const tot = Object.values(g).reduce((s, v) => s + v.total_val, 0);
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';

    let colorIndex = 0;
    Object.entries(g).forEach(([name, gr]) => {
        const c = GRP_COLORS[colorIndex % GRP_COLORS.length];
        colorIndex++;
        const profit = gr.total_val - gr.total_inv;
        const isCol = !!collapsed[name];

        // Group header
        const tr = document.createElement('tr');
        tr.className = 'tr-group'; tr.dataset.g = name;
        tr.innerHTML = `<td colspan="7">
<div class="group-inner">
<div style="width:18px;height:18px;border-radius:4px;background:${c}22;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
</div>
<span class="gchev ${isCol ? '' : 'open'}">▶</span>
<span class="gname">${name}</span>
<span class="gmeta">${gr.assets.length} activos · ${tot > 0 ? (gr.total_val / tot * 100).toFixed(1) : 0}%</span>
<div class="gright">
  <span class="gval">${eur(gr.total_val)}</span>
  <span class="gval ${profit >= 0 ? 'up' : 'down'}">${profit >= 0 ? '+' : ''}${eur(profit)}</span>
</div>
</div></td>`;
        tr.addEventListener('click', () => toggleGroup(name, tr));
        tbody.appendChild(tr);

        // Assets
        const sorted = [...gr.assets].sort((a, b) => {
            const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
            return sortDir * (typeof av === 'string' ? av.localeCompare(bv) : av - bv);
        });

        sorted.forEach(asset => {
            if (!asset.profit && asset.profit !== 0) asset.profit = asset.value - asset.invested;
            const ap = tot > 0 ? (asset.value / tot * 100) : 0;
            const atr = document.createElement('tr');
            atr.className = 'tr-asset'; atr.dataset.pg = name;
            if (isCol) atr.style.display = 'none';
            atr.innerHTML = `
<td>${asset.name}</td>
<td class="mono">${eur(asset.invested)}</td>
<td class="mono">${eur(asset.value)}</td>
<td class="mono ${asset.profit >= 0 ? 'up' : 'down'}">${asset.profit >= 0 ? '+' : ''}${eur(asset.profit)}</td>
<td class="mono ${asset.twr >= 0 ? 'up' : 'down'}">${pct(asset.twr)}</td>
<td class="mono ${asset.mwr >= 0 ? 'up' : 'down'}">${pct(asset.mwr)}</td>
<td>
  <div class="mbar-wrap">
    <div class="mbar"><div class="mbar-fill" style="width:${Math.min(ap * 3, 100)}%;background:${c};"></div></div>
    <span class="mpct">${ap.toFixed(1)}%</span>
  </div>
</td>`;
            tbody.appendChild(atr);
        });
    });
}

function toggleGroup(name, tr) {
    collapsed[name] = !collapsed[name];
    const isCol = collapsed[name];
    tr.querySelector('.gchev').className = 'gchev ' + (isCol ? '' : 'open');
    document.querySelectorAll(`[data-pg="${name}"]`).forEach(r => r.style.display = isCol ? 'none' : '');
}

// ── Sort ──
function initSort() {
    document.querySelectorAll('th[data-col]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = -1; }
            document.querySelectorAll('th').forEach(t => t.className = '');
            th.className = sortDir === -1 ? 'desc' : 'asc';
            renderTable();
        });
    });
}

// ── Toggles ──
function initToggles() {
    document.querySelectorAll('.ptog').forEach(el => {
        el.addEventListener('click', () => {
            const p = el.dataset.p;
            if (activePorts.has(p)) {
                if (activePorts.size > 1) { activePorts.delete(p); el.classList.remove('active'); }
            } else {
                activePorts.add(p); el.classList.add('active');
            }
            renderTrend();
        });
    });
}

// ── Time pills ──
function initPills() {
    document.querySelectorAll('.pill').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            tRange = b.dataset.r;
            renderTrend();
        });
    });
}

// ── Fullscreen ──
let fschart = null;
function openFs(type) {
    const ov = document.getElementById('fs-ov');
    const body = document.getElementById('fs-body');
    const title = document.getElementById('fs-t');
    body.innerHTML = ''; body.style.cssText = 'height:500px;position:relative;';
    ov.classList.add('open');

    if (type === 'trend') {
        title.textContent = 'Evolución del Patrimonio';
        const togs = document.createElement('div');
        togs.className = 'port-toggles';
        ['CASH', 'CRYPTO', 'FUNDS', 'ETFS'].forEach(p => {
            const b = document.createElement('div');
            b.className = 'ptog ' + (activePorts.has(p) ? 'active c-' + p.toLowerCase() : '');
            b.dataset.p = p;
            b.innerHTML = `<span class="dot" style="background:var(--${p.toLowerCase() === 'etfs' ? 'etfs' : p.toLowerCase() ===
                'cash' ? 'cash' : p.toLowerCase() === 'crypto' ? 'crypto' : 'funds'})"></span>${LABELS[p]}`;
            b.addEventListener('click', () => {
                if (activePorts.has(p)) { if (activePorts.size > 1) { activePorts.delete(p); b.classList.remove('active'); } }
                else { activePorts.add(p); b.classList.add('active'); }
                renderTrend('fsTrend');
                document.querySelectorAll('.ptog[data-p="' + p + '"]').forEach(el => {
                    el.classList.toggle('active', activePorts.has(p));
                });
            });
            togs.appendChild(b);
        });
        const canvasWrap = document.createElement('div');
        canvasWrap.style.cssText = 'height:440px;position:relative;margin-top:12px;';
        const cv = document.createElement('canvas');
        cv.id = 'fsTrend'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Trend chart fullscreen');
        canvasWrap.appendChild(cv);
        body.style.height = 'auto';
        body.appendChild(togs);
        body.appendChild(canvasWrap);
        setTimeout(() => renderTrend('fsTrend'), 60);

    } else if (type === 'donut') {
        title.textContent = 'Distribución del Portfolio';
        body.style.cssText = 'display:flex;align-items:center;gap:48px;min-height:400px;';
        body.innerHTML = `
<div style="flex-shrink:0;width:300px;height:300px;position:relative;display:flex;align-items:center;justify-content:center;">
<canvas id="fsDon" style="max-width:280px;max-height:280px;" role="img" aria-label="Donut fullscreen"></canvas>
<div style="position:absolute;text-align:center;pointer-events:none;">
<span style="font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:500;letter-spacing:-1px;display:block;" id="fsdc">—</span>
<span style="font-size:11px;color:var(--text-3);font-weight:700;text-transform:uppercase;letter-spacing:.5px;">Total</span>
</div>
</div>
<div id="fsDonLeg" style="flex:1;display:flex;flex-direction:column;gap:12px;"></div>`;
        setTimeout(() => {
            const g = DATA.portfolios_grouped, lbls = Object.keys(g), vals = lbls.map(k => g[k].total_val);
            const tot = vals.reduce((a, b) => a + b, 0);
            document.getElementById('fsdc').textContent = eur(tot);
            document.getElementById('fsDonLeg').innerHTML = lbls.map((l, i) => `
<div style="display:flex;align-items:center;gap:12px;">
<div style="width:12px;height:12px;border-radius:3px;background:${GRP_COLORS[i % GRP_COLORS.length]};flex-shrink:0;"></div>
<div style="flex:1;font-weight:600;font-size:14px;">${l}</div>
<div style="font-family:'JetBrains Mono',monospace;font-size:14px;">${eur(vals[i])}</div>
<div style="color:var(--text-3);font-size:12px;min-width:44px;text-align:right;">${tot > 0 ? (vals[i] / tot * 100).toFixed(1) : 0}%</div>
</div>`).join('');
            const ctx = document.getElementById('fsDon').getContext('2d');
            if (fschart) fschart.destroy();
            fschart = new Chart(ctx, {
                type: 'doughnut', data: { labels: lbls, datasets: [{ data: vals, backgroundColor: GRP_COLORS, borderWidth: 0, hoverOffset: 8 }] },
                options: { responsive: true, maintainAspectRatio: true, cutout: '70%', plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111110', callbacks: { label: c => ` ${eur(c.parsed)} (${tot > 0 ? (c.parsed / tot * 100).toFixed(1) : 0}%)` } } } }
            });
        }, 60);

    } else if (type === 'monthly') {
        title.textContent = 'Rentabilidad Mensual';
        const cv = document.createElement('canvas');
        cv.id = 'fsMon'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Monthly returns fullscreen');
        body.appendChild(cv);
        setTimeout(() => renderMonthly('fsMon'), 60);
    }
}

function closeFs() {
    document.getElementById('fs-ov').classList.remove('open');
    if (charts['fsTrend']) { charts['fsTrend'].destroy(); delete charts['fsTrend']; }
    if (charts['fsMon']) { charts['fsMon'].destroy(); delete charts['fsMon']; }
    if (fschart) { fschart.destroy(); fschart = null; }
}
function fsBgClose(e) { if (e.target === document.getElementById('fs-ov')) closeFs(); }

// ── Arrancamos la aplicación ──
init();