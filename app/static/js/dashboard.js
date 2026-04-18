// ─── UTILS ───────────────────────────────────────────────
        const eur = n => {
            const abs = Math.abs(n);
            const dec = abs < 1 ? 5 : abs < 100 ? 2 : 0;
            return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
        };
        const pct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

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
        let financeChart = null, savingTrendChart = null, retirementChart = null;
        let draggedTransactionId = null;

        // ─── INIT ─────────────────────────────────────────────────
        async function init() {
            try {
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
                    fetch('/api/data'),
                    fetchCategoriesCache(),
                    fetch('/api/transactions')
                ]);
                DATA = await dataResp.json();
                ALL_TRANSACTIONS = await txResp.json();

                if (DATA.error) { alert('No hay datos en la base de datos.'); return; }
            } catch (err) {
                console.error('Error conectando con el servidor:', err); return;
            }

            const s = DATA.summary;
            document.getElementById('date-pill').textContent = s.date;
            document.getElementById('sfoot').innerHTML = `Actualizado:<br>${s.date}`;

            const safeRender = fn => { try { fn(); } catch (e) { console.error('Render error:', e); } };
            safeRender(renderKPIs);
            safeRender(renderSparklines);
            safeRender(renderTrend);
            safeRender(renderDonut);
            safeRender(renderMonthly);
            safeRender(renderAlloc);
            safeRender(renderTable);
            initToggles(); initPills(); initSort();
            showPage('dashboard');
            generatePortfolioInsight();
        }

        // ─── PAGE NAV ─────────────────────────────────────────────
        function showPage(page) {
            ['dashboard', 'transactions', 'finanzas', 'retirement'].forEach(p => {
                const el = document.getElementById(`page-${p}`);
                if (el) el.style.display = p === page ? 'block' : 'none';
            });
            document.querySelectorAll('.nav-item').forEach(i => {
                const isActive = i.id === `nav-${page}`;
                i.classList.toggle('active', isActive);
                i.style.color = '';
            });
            if (page === 'transactions') fetchTransactions();
            if (page === 'finanzas') loadFinanceData();
            if (page === 'retirement') loadRetirementData();
        }

        // ─── PORTFOLIO AI INSIGHT ──────────────────────────────────
        async function generatePortfolioInsight() {
            const s = DATA?.summary;
            if (!s) return;
            const portfolioSummary = JSON.stringify({
                totalValue: s.total_money,
                totalProfit: s.total_profit,
                totalInvested: s.total_invested,
                twr: s.global_twr,
                mwr: s.global_mwr,
                distribution: DATA.portfolios_grouped
            });

            try {
                const res = await fetch('/api/portfolio/analysis', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ portfolio: portfolioSummary })
                });
                const parsed = await res.json();

                document.getElementById('ai-portfolio-text').textContent = parsed.summary;
                document.getElementById('ai-portfolio-items').innerHTML = parsed.items.map(i => `
      <div class="ai-item">
        <div class="ai-item-icon" style="background:rgba(37,99,235,0.08)">${i.icon}</div>
        <span>${i.text}</span>
      </div>
    `).join('');
            } catch (e) {
                document.getElementById('ai-portfolio-text').textContent = 'No se pudo generar el análisis. Comprueba la conexión con la API.';
            }
        }

        // ─── PORTFOLIO KPIs ───────────────────────────────────────
        function renderKPIs() {
            const s = DATA.summary;
            const pp = s.total_invested > 0 ? (s.total_profit / s.total_invested * 100) : 0;
            set('k-total', eur(s.total_money)); setb('k-total-b', pct(pp), pp >= 0);
            set('k-profit', eur(s.total_profit)); setb('k-profit-b', pct(pp), s.total_profit >= 0);
            setv('k-twr', pct(s.global_twr), s.global_twr >= 0);
            setv('k-mwr', pct(s.global_mwr), s.global_mwr >= 0);
        }
        const set = (id, v) => document.getElementById(id).textContent = v;
        const setb = (id, v, up) => { const el = document.getElementById(id); el.textContent = v; el.className = 'badge ' + (up ? 'up' : 'down'); };
        const setv = (id, v, up) => { const el = document.getElementById(id); el.textContent = v; el.className = 'kpi-val ' + (up ? 'up' : 'down'); };

        function renderSparklines() {
            const p = DATA.history_portfolios, d = DATA.history_global;
            const tot = d.dates.map((_, i) => (p.CASH[i] || 0) + (p.CRYPTO[i] || 0) + (p.FUNDS[i] || 0) + (p.ETFS[i] || 0));
            spark('sp-total', tot, '#15803D');
            spark('sp-profit', tot.map((v, i) => v - d.invested[i]), '#15803D');
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

        // ─── TREND CHART ──────────────────────────────────────────
        function filteredData() {
            const { dates, invested } = DATA.history_global;
            const last = new Date(dates[dates.length - 1]); let cut = new Date('1900-01-01');
            if (tRange === '1M') { cut = new Date(last); cut.setMonth(cut.getMonth() - 1); }
            if (tRange === '3M') { cut = new Date(last); cut.setMonth(cut.getMonth() - 3); }
            if (tRange === '6M') { cut = new Date(last); cut.setMonth(cut.getMonth() - 6); }
            if (tRange === '1Y') { cut = new Date(last); cut.setFullYear(cut.getFullYear() - 1); }
            const idx = dates.reduce((a, d, i) => { if (new Date(d) >= cut) a.push(i); return a; }, []);
            const p = DATA.history_portfolios;
            return {
                labels: idx.map(i => dates[i]), invested: idx.map(i => invested[i]),
                CASH: idx.map(i => p.CASH[i] || 0), CRYPTO: idx.map(i => p.CRYPTO[i] || 0),
                FUNDS: idx.map(i => p.FUNDS[i] || 0), ETFS: idx.map(i => p.ETFS[i] || 0)
            };
        }
        function renderTrend(cid = 'trendChart') {
            const fd = filteredData(); const ctx = document.getElementById(cid)?.getContext('2d');
            if (!ctx) return; if (charts[cid]) charts[cid].destroy();
            const sets = ['CASH', 'CRYPTO', 'FUNDS', 'ETFS'].filter(p => activePorts.has(p)).map(p => ({
                label: LABELS[p], data: fd[p], backgroundColor: COLORS[p].bg, borderColor: COLORS[p].bd,
                borderWidth: 1.5, fill: true, tension: .4, pointRadius: 0, stack: 'p'
            }));
            sets.push({ label: 'Capital Invertido', data: fd.invested, borderColor: '#0E0D0B', borderWidth: 2, borderDash: [7, 5], fill: false, tension: .4, pointRadius: 0, stack: 'i' });
            charts[cid] = new Chart(ctx, {
                type: 'line', data: { labels: fd.labels, datasets: sets },
                options: {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0E0D0B', titleColor: '#A8A49C', bodyColor: '#fff', padding: 12, cornerRadius: 8, callbacks: { label: c => ` ${c.dataset.label}: ${eur(c.parsed.y)}` } } },
                    scales: { x: { type: 'time', time: { tooltipFormat: 'dd MMM yyyy', displayFormats: { month: 'MMM yy', week: 'dd MMM' } }, grid: { display: false }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, maxTicksLimit: 7 } }, y: { stacked: true, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, callback: v => eur(v) } } }
                }
            });
        }

        function renderDonut() {
            const g = DATA.portfolios_grouped; const lbls = Object.keys(g), vals = lbls.map(k => g[k].total_val);
            const tot = vals.reduce((a, b) => a + b, 0);
            document.getElementById('dc-val').textContent = eur(tot);
            document.getElementById('donut-leg').innerHTML = lbls.map((l, i) => `
    <div class="dleg-row"><div class="dleg-dot" style="background:${GRP_COLORS[i % GRP_COLORS.length]}"></div>
    <span class="dleg-name">${l}</span><span class="dleg-val">${eur(vals[i])}</span>
    <span class="dleg-pct">${tot > 0 ? (vals[i] / tot * 100).toFixed(1) : 0}%</span></div>`).join('');
            const ctx = document.getElementById('donutChart').getContext('2d');
            if (charts.donut) charts.donut.destroy();
            charts.donut = new Chart(ctx, {
                type: 'doughnut', data: { labels: lbls, datasets: [{ data: vals, backgroundColor: GRP_COLORS, borderWidth: 0, hoverOffset: 6 }] },
                options: { responsive: true, maintainAspectRatio: true, cutout: '72%', plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0E0D0B', callbacks: { label: c => ` ${eur(c.parsed)} (${tot > 0 ? (c.parsed / tot * 100).toFixed(1) : 0}%)` } } } }
            });
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
            charts[cid] = new Chart(ctx, {
                type: 'bar', data: { labels: lbls, datasets: [{ data: vals, backgroundColor: vals.map(v => v >= 0 ? 'rgba(21,128,61,.65)' : 'rgba(220,38,38,.65)'), borderRadius: 4, borderSkipped: false }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0E0D0B', callbacks: { label: c => ` ${c.parsed.y >= 0 ? '+' : ''}${eur(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, maxRotation: 40, autoSkip: false } }, y: { grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false }, ticks: { color: '#A8A49C', font: { size: 10 }, callback: v => eur(v) } } } }
            });
        }

        function renderAlloc() {
            const g = DATA.portfolios_grouped; const tot = Object.values(g).reduce((s, v) => s + v.total_val, 0);
            document.getElementById('alloc-list').innerHTML = Object.entries(g).map(([name, gr], i) => {
                const p = tot > 0 ? (gr.total_val / tot * 100) : 0, profit = gr.total_val - gr.total_inv, pp = gr.total_inv > 0 ? (profit / gr.total_inv * 100).toFixed(1) : 0, c = GRP_COLORS[i % GRP_COLORS.length];
                return `<div class="alloc-item"><div class="alloc-row"><div class="alloc-name"><div style="width:8px;height:8px;border-radius:2px;background:${c}"></div>${name}</div><div><span class="alloc-right">${eur(gr.total_val)}</span><span style="font-size:11px;margin-left:6px;color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};">${profit >= 0 ? '+' : ''}${pp}%</span></div></div><div class="alloc-bar"><div class="alloc-fill" style="width:${p.toFixed(1)}%;background:${c}"></div></div><div class="alloc-sub">${p.toFixed(1)}% del patrimonio · ${eur(gr.total_inv)} invertido</div></div>`;
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
                tr.innerHTML = `<td colspan="9"><div class="group-inner"><div style="width:18px;height:18px;border-radius:4px;background:${c}22;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg></div><span class="gchev ${isCol ? '' : 'open'}">▶</span><span class="gname">${name}</span><span class="gmeta">${gr.assets.length} activos · ${tot > 0 ? (gr.total_val / tot * 100).toFixed(1) : 0}%</span><div class="gright"><span class="gval">${eur(gr.total_val)}</span><span class="gval ${profit >= 0 ? 'up' : 'down'}">${profit >= 0 ? '+' : ''}${eur(profit)}</span></div></div></td>`;
                tr.addEventListener('click', () => { collapsed[name] = !collapsed[name]; const ic = collapsed[name]; tr.querySelector('.gchev').className = 'gchev ' + (ic ? '' : 'open'); document.querySelectorAll(`[data-pg="${name}"]`).forEach(r => r.style.display = ic ? 'none' : ''); });
                tbody.appendChild(tr);
                [...gr.assets].sort((a, b) => { const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0; return sortDir * (typeof av === 'string' ? av.localeCompare(bv) : av - bv); }).forEach(asset => {
                    const ap = tot > 0 ? (asset.value / tot * 100) : 0, atr = document.createElement('tr');
                    atr.className = 'tr-asset'; atr.dataset.pg = name; if (isCol) atr.style.display = 'none';
                    const isCash = asset.portfolio === 'CASH';
                    const hT = isCash ? '-' : (asset.holdings < 1 ? asset.holdings.toFixed(4) : asset.holdings.toLocaleString('es-ES'));
                    const pT = isCash ? '-' : eur(asset.price);
                    const iT = isCash ? '-' : eur(asset.invested);
                    const prT = isCash ? '-' : (asset.profit >= 0 ? '+' : '') + eur(asset.profit);
                    const twrT = isCash ? '-' : pct(asset.twr);
                    const mwrT = isCash ? '-' : pct(asset.mwr);
                    atr.innerHTML = `<td>${asset.name}</td><td class="mono" style="text-align:right">${hT}</td><td class="mono" style="text-align:right">${pT}</td><td class="mono" style="text-align:right">${iT}</td><td class="mono" style="text-align:right">${eur(asset.value)}</td><td class="mono ${!isCash && asset.profit >= 0 ? 'up' : 'down'}" style="text-align:right">${prT}</td><td class="mono ${!isCash && asset.twr >= 0 ? 'up' : 'down'}" style="text-align:center">${twrT}</td><td class="mono ${!isCash && asset.mwr >= 0 ? 'up' : 'down'}" style="text-align:center">${mwrT}</td><td><div class="mbar-wrap"><div class="mbar"><div class="mbar-fill" style="width:${Math.min(ap * 3, 100)}%;background:${c}"></div></div><span class="mpct">${ap.toFixed(1)}%</span></div></td>`;
                    tbody.appendChild(atr);
                });
            });
        }
        function initSort() { document.querySelectorAll('th[data-col]').forEach(th => { th.addEventListener('click', () => { const col = th.dataset.col; if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = -1; } document.querySelectorAll('th').forEach(t => t.className = ''); th.className = sortDir === -1 ? 'desc' : 'asc'; renderTable(); }); }); }
        function initToggles() { document.querySelectorAll('.ptog').forEach(el => { el.addEventListener('click', () => { const p = el.dataset.p; if (activePorts.has(p)) { if (activePorts.size > 1) activePorts.delete(p); } else { activePorts.add(p); } document.querySelectorAll(`.ptog[data-p="${p}"]`).forEach(btn => btn.classList.toggle('active', activePorts.has(p))); renderTrend(); renderMonthly(); }); }); }
        function initPills() { document.querySelectorAll('.pill[data-r]').forEach(b => { b.addEventListener('click', () => { document.querySelectorAll('.pill[data-r]').forEach(x => x.classList.remove('active')); b.classList.add('active'); tRange = b.dataset.r; renderTrend(); }); }); }

        // ════════════════════════════════════════════════════════════
        // TRANSACTIONS — REDESIGNED UI
        // ════════════════════════════════════════════════════════════
        let txSearchTimeout;
        function debouncedRenderTransactions() { clearTimeout(txSearchTimeout); txSearchTimeout = setTimeout(renderTransactionsTable, 300); }

        async function fetchTransactions() {
            try { const r = await fetch('/api/transactions'); ALL_TRANSACTIONS = await r.json(); renderTransactionsTable(); }
            catch (e) { console.error('Error cargando transacciones:', e); }
        }

        async function fetchCategoriesCache() {
            const r = await fetch('/api/categories'); CATEGORIES_CACHE = await r.json();
        }

        async function handleFileUpload(input) {
            if (!input.files || !input.files.length) return;
            const file = input.files[0], source = document.getElementById('import-source').value;
            const formData = new FormData(); formData.append('file', file); formData.append('source', source);
            try {
                document.querySelector('[onclick*="import-file"]').textContent = 'Procesando...';
                const r = await fetch('/api/transactions/import', { method: 'POST', body: formData });
                const res = await r.json();
                if (res.imported !== undefined) { alert(`¡Importados ${res.imported} movimientos.`); fetchTransactions(); }
                else alert('Error: ' + (res.error || 'Problema inesperado'));
            } catch (e) { alert('Error de conexión.'); }
            finally { document.querySelector('[onclick*="import-file"]').textContent = 'Importar'; input.value = ''; }
        }

        function renderTransactionsTable() {
            const query = (document.getElementById('tx-search')?.value || '').toLowerCase();
            const typeF = document.getElementById('filter-type')?.value || 'ALL';
            const statusF = document.getElementById('filter-status')?.value || 'ALL';

            // New column filters
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

            // Build lookup & parent-child structure
            const byId = {}; filtered.forEach(t => byId[t.id] = t);
            const roots = filtered.filter(t => !t.linked_transaction_id || !byId[t.linked_transaction_id]);
            const childrenByParent = {};
            filtered.forEach(t => { if (t.linked_transaction_id) { if (!childrenByParent[t.linked_transaction_id]) childrenByParent[t.linked_transaction_id] = []; childrenByParent[t.linked_transaction_id].push(t); } });

            // Group by month
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
                const monthInc = txsInMonth.reduce((s, { root, children }) => {
                    // Si el grupo/tx principal es un movimiento, no lo sumamos a las estadísticas
                    if (root.category === 'Movimientos') return s;
                    // Sumamos el neto de todo el grupo (o la tx sola)
                    const netAmt = root.amount + children.reduce((a, c) => a + c.amount, 0);
                    return s + (netAmt > 0 ? netAmt : 0);
                }, 0);
                const monthExp = txsInMonth.reduce((s, { root, children }) => {
                    if (root.category === 'Movimientos') return s;
                    const netAmt = root.amount + children.reduce((a, c) => a + c.amount, 0);
                    return s + (netAmt < 0 ? Math.abs(netAmt) : 0);
                }, 0);

                // Month header
                const mh = document.createElement('div');
                mh.className = 'tx-month-header';
                mh.innerHTML = `
      <span class="tx-month-label">${label}</span>
      <div class="tx-month-stats">
        <span class="tx-month-stat up">+${eur(monthInc)}</span>
        <span class="tx-month-stat down">-${eur(monthExp)}</span>
        <span class="tx-month-stat" style="color:${monthInc - monthExp >= 0 ? 'var(--green)' : 'var(--red)'};">${monthInc - monthExp >= 0 ? '+' : ''}${eur(monthInc - monthExp)}</span>
      </div>
    `;
                wrap.appendChild(mh);

                txsInMonth.forEach(({ root, children }) => {
                    if (children.length > 0) {
                        wrap.appendChild(buildGroupBlock(root, children));
                    } else {
                        wrap.appendChild(buildTxRow(root, false));
                    }
                });
            });
        }

        function buildGroupBlock(parent, children) {
            const totalAmount = parent.amount + children.reduce((s, c) => s + c.amount, 0);
            const isMovimiento = parent.category === 'Movimientos';
            const amtClass = isMovimiento ? 'neutral-amount' : (totalAmount >= 0 ? 'up' : 'down');
            const block = document.createElement('div');
            block.className = 'tx-group-block';
            const gid = `grp-${parent.id}`;

            const header = document.createElement('div');
            header.className = 'tx-group-header';
            header.dataset.toggleGroup = gid;
            header.innerHTML = `
    <div class="tx-group-chevron" id="chev-${gid}">▶</div>
    <span class="tx-group-sum">Σ</span>
    <span class="tx-group-desc" style="display:flex;align-items:center;gap:6px">
        ${parent.description}
        <button class="btn-icon-soft" onclick="event.stopPropagation(); renameTransaction(${parent.id}, '${parent.description.replace(/'/g, "\\'")}')" title="Renombrar transacción"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
    </span>
    <span class="tx-group-badge">${children.length + 1} MOV</span>
    <span class="tx-group-amount ${amtClass}" style="margin-right:12px">${eur(totalAmount)}</span>
    <div style="position:relative;display:inline-block">
      ${buildCatPillHTML(parent)}
      <div id="popover-g-${parent.id}" class="cat-popover" onclick="event.stopPropagation()" style="right:0;left:auto"></div>
    </div>
    <button class="btn-del" onclick="event.stopPropagation();deleteTransaction(${parent.id})" style="opacity:.4;margin-left:8px">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
    </button>
  `;
            header.querySelector('.tx-group-chevron').addEventListener('click', e => { e.stopPropagation(); toggleGroupBlock(gid); });
            const catPill = header.querySelector('.cat-pill');
            if (catPill) catPill.addEventListener('click', e => { e.stopPropagation(); toggleCategoryPopover(e, parent.id, 'g-'); });
            block.appendChild(header);

            // drag and drop support for groups
            header.addEventListener('dragover', e => {
                e.preventDefault();
                header.style.background = 'rgba(37, 99, 235, 0.08)';
                header.style.outline = '2px dashed var(--accent)';
                header.style.outlineOffset = '-2px';
            });
            header.addEventListener('dragleave', () => {
                header.style.background = '';
                header.style.outline = '';
            });
            header.addEventListener('drop', e => {
                e.preventDefault();
                header.style.background = '';
                header.style.outline = '';
                const cid = e.dataTransfer.getData('text/plain');
                if (cid && cid != String(parent.id)) linkTransactions(cid, parent.id);
            });

            const body = document.createElement('div');
            body.className = 'tx-group-body';
            body.id = gid;

            // parent child row
            body.appendChild(buildGroupChildRow(parent, true));
            children.forEach(c => body.appendChild(buildGroupChildRow(c, false)));
            block.appendChild(body);
            return block;
        }

        function buildGroupChildRow(t, isParent) {
            const row = document.createElement('div');
            row.className = 'tx-group-child';
            row.setAttribute('draggable', 'true');
            row.dataset.id = t.id;
            const isMovimiento = t.category === 'Movimientos';
            const amtClass = isMovimiento ? 'neutral-amount' : (t.amount >= 0 ? 'up' : 'down');
            row.innerHTML = `
    <div class="tx-date-col" style="padding-left:0">${t.date}</div>
    <div class="tx-source-col"><span class="src-badge src-${t.source.toLowerCase()}">${t.source}</span></div>
    <div class="tx-desc-col">
      <div class="tx-desc-main" style="display:inline-flex;align-items:center;gap:6px">
        ${t.description}${isParent ? '' : ''}
        <button class="btn-icon-soft" onclick="event.stopPropagation(); renameTransaction(${t.id}, '${t.description.replace(/'/g, "\\'")}')" title="Renombrar transacción"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
      </div>
    </div>
    <div class="tx-amount-col ${amtClass}" style="opacity:0.8">${eur(t.amount)}</div>
    <div class="tx-cat-col" style="position:relative">
      ${buildCatPillHTML(t)}
      <div id="popover-${t.id}" class="cat-popover" onclick="event.stopPropagation()"></div>
    </div>
    <div class="tx-status-col">
      <span class="${t.is_reviewed ? 'status-ok' : 'status-ia'}" onclick="toggleReviewed(${t.id},${!t.is_reviewed})">${t.is_reviewed ? '✓ OK' : 'IA'}</span>
    </div>
    <div class="tx-actions-col" style="gap:4px">
      ${t.linked_transaction_id ? `<button class="btn-del" onclick="unlinkTransaction(${t.id})" title="Desvincular" style="opacity:0.4;color:var(--accent)"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>` : ''}
      <button class="btn-del" onclick="deleteTransaction(${t.id})"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
    </div>
  `;
            const catPill = row.querySelector('.cat-pill');
            if (catPill) catPill.addEventListener('click', e => { e.stopPropagation(); toggleCategoryPopover(e, t.id); });
            // drag
            row.addEventListener('dragstart', e => { draggedTransactionId = t.id; row.style.opacity = '.4'; e.dataTransfer.setData('text/plain', t.id); if (t.linked_transaction_id) document.getElementById('unlink-zone').classList.add('visible'); });
            row.addEventListener('dragend', () => { row.style.opacity = '1'; document.getElementById('unlink-zone').classList.remove('visible'); });
            return row;
        }

        function buildTxRow(t, isChild = false) {
            const row = document.createElement('div');
            row.className = 'tx-row';
            row.setAttribute('draggable', 'true');
            row.dataset.id = t.id;
            const isMovimiento = t.category === 'Movimientos';
            const amtClass = isMovimiento ? 'neutral-amount' : (t.amount >= 0 ? 'up' : 'down');
            row.innerHTML = `
    <div class="tx-date-col">${t.date}</div>
    <div class="tx-source-col"><span class="src-badge src-${t.source.toLowerCase()}">${t.source}</span></div>
    <div class="tx-desc-col">
      <div class="tx-desc-main" style="display:inline-flex;align-items:center;gap:6px">
        ${t.description}
        <button class="btn-icon-soft" onclick="event.stopPropagation(); renameTransaction(${t.id}, '${t.description.replace(/'/g, "\\'")}')" title="Renombrar transacción"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
      </div>
      ${t.subcategory ? `<div class="tx-desc-sub">${t.subcategory}</div>` : ''}
    </div>
    <div class="tx-amount-col ${amtClass}">${eur(t.amount)}</div>
    <div class="tx-cat-col" style="position:relative">
      ${buildCatPillHTML(t)}
      <div id="popover-${t.id}" class="cat-popover" onclick="event.stopPropagation()"></div>
    </div>
    <div class="tx-status-col">
      <span class="${t.is_reviewed ? 'status-ok' : 'status-ia'}" onclick="toggleReviewed(${t.id},${!t.is_reviewed})">${t.is_reviewed ? '✓ OK' : 'IA'}</span>
    </div>
    <div class="tx-actions-col">
      <button class="btn-del" onclick="deleteTransaction(${t.id})">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    </div>
  `;
            const catPill = row.querySelector('.cat-pill');
            if (catPill) catPill.addEventListener('click', e => { e.stopPropagation(); toggleCategoryPopover(e, t.id); });
            // drag
            row.addEventListener('dragstart', e => { draggedTransactionId = t.id; row.style.opacity = '.4'; e.dataTransfer.setData('text/plain', t.id); });
            row.addEventListener('dragend', () => { row.style.opacity = '1'; document.querySelectorAll('.tx-row,.tx-group-block').forEach(el => el.classList.remove('over')); document.getElementById('unlink-zone').classList.remove('visible'); });
            row.addEventListener('dragover', e => { e.preventDefault(); if (draggedTransactionId !== String(t.id)) row.style.outline = '2px dashed var(--accent)'; });
            row.addEventListener('dragleave', () => row.style.outline = '');
            row.addEventListener('drop', e => { e.preventDefault(); row.style.outline = ''; const cid = e.dataTransfer.getData('text/plain'); if (cid && cid != String(t.id)) linkTransactions(cid, t.id); });
            return row;
        }

        function buildCatPillHTML(t) {
            const reviewed = t.is_reviewed;
            const catText = t.category || (reviewed ? 'Categorizado' : 'Sin categoría');
            return `<span class="cat-pill ${reviewed ? 'reviewed' : ''}">${catText}${t.subcategory ? ` · ${t.subcategory}` : ''}</span>`;
        }

        function toggleGroupBlock(gid) {
            const body = document.getElementById(gid);
            const chev = document.getElementById('chev-' + gid);
            if (!body) return;
            const isOpen = body.classList.toggle('open');
            chev.textContent = isOpen ? '▼' : '▶';
            chev.classList.toggle('open', isOpen);
        }

        function toggleCategoryPopover(event, txId, prefix = '') {
            const popId = `popover-${prefix}${txId}`;
            const popover = document.getElementById(popId);
            if (!popover) return;
            const isOpen = popover.classList.contains('open');
            document.querySelectorAll('.cat-popover').forEach(p => p.classList.remove('open'));
            if (!isOpen) {
                renderCategoryPopover(popover, txId);
                popover.classList.add('open');
                setTimeout(() => document.addEventListener('click', function h(e) { if (!popover.contains(e.target)) { popover.classList.remove('open'); document.removeEventListener('click', h); } }, 10));
            }
        }

        function renderCategoryPopover(container, txId) {
            container.innerHTML = `<div class="cat-pop-title">Seleccionar Categoría</div>`;
            CATEGORIES_CACHE.forEach(cat => {
                const g = document.createElement('div');
                g.className = 'cat-pop-group';
                g.innerHTML = `<div class="cat-pop-group-name" style="color:${cat.color || 'var(--text-3)'}">${cat.name}</div><div class="cat-pop-subs"></div>`;
                const subWrap = g.querySelector('.cat-pop-subs');
                cat.subcategories.forEach(sub => {
                    const btn = document.createElement('button');
                    btn.className = 'cat-pop-sub'; btn.textContent = sub.name;
                    btn.onclick = () => updateTransactionCategory(txId, cat.id, sub.id);
                    subWrap.appendChild(btn);
                });
                container.appendChild(g);
            });
        }

        async function updateTransactionCategory(txId, catId, subId) {
            await fetch(`/api/transactions/${txId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category_id: catId, subcategory_id: subId, is_reviewed: true }) });
            fetchTransactions();
        }
        async function toggleReviewed(txId, status) {
            await fetch(`/api/transactions/${txId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_reviewed: status }) });
            fetchTransactions();
        }
        async function linkTransactions(childId, parentId) {
            await fetch('/api/transactions/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ child_id: childId, parent_id: parentId }) });
            fetchTransactions();
        }
        async function unlinkTransaction(txId) {
            await fetch('/api/transactions/unlink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: txId }) });
            fetchTransactions();
        }
        async function renameTransaction(txId, currentName) {
            const newName = prompt('Introduce el nuevo nombre o descripción para esta transacción (o grupo):', currentName);
            if (!newName || newName === currentName) return;
            try {
                await fetch(`/api/transactions/${txId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: newName })
                });
                fetchTransactions();
            } catch (e) {
                alert('No se pudo renombrar la transacción.');
            }
        }
        async function deleteTransaction(txId) {
            if (!confirm('¿Eliminar esta transacción?')) return;
            try { const r = await fetch(`/api/transactions/${txId}`, { method: 'DELETE' }); if (r.ok) { fetchTransactions(); if (typeof loadFinanceData === 'function') loadFinanceData(); } else alert('Error al eliminar'); }
            catch (e) { alert('Error de conexión'); }
        }

        // ════════════════════════════════════════════════════════════
        // FINANCIAL INTELLIGENCE — ENHANCED & FIXED
        // ════════════════════════════════════════════════════════════
        async function loadFinanceData() {
            try {
                const r = await fetch('/api/transactions');
                const allTx = await r.json();

                // Build proper set of root transactions only
                // (parents of groups and standalone transactions — NOT children)
                const byId = {}; allTx.forEach(t => byId[t.id] = t);
                const childIds = new Set(allTx.filter(t => t.linked_transaction_id).map(t => t.id));
                // Also, child records have linked_transaction_id pointing to parent
                // So: root = those that are NOT children of someone else
                const rootTx = allTx.filter(t => !t.linked_transaction_id);

                // For grouped transactions, the parent represents the group.
                // Compute effective amount = parent + all children sums
                const childrenByParent = {};
                allTx.filter(t => t.linked_transaction_id).forEach(t => {
                    if (!childrenByParent[t.linked_transaction_id]) childrenByParent[t.linked_transaction_id] = [];
                    childrenByParent[t.linked_transaction_id].push(t);
                });

                // Helper: get effective amount for a root tx
                const effectiveAmount = t => {
                    if (childrenByParent[t.id]) {
                        return t.amount + childrenByParent[t.id].reduce((s, c) => s + c.amount, 0);
                    }
                    return t.amount;
                };

                // Exclude internal transfers
                const filtered = rootTx.filter(t => t.category !== 'Movimientos');

                const statsByMonth = {};
                const recurringMap = {};
                const catData = { needs: 0, wants: 0, savings: 0 };
                const categoryTotals = {};

                filtered.forEach(t => {
                    const month = t.date.substring(0, 7);
                    if (!statsByMonth[month]) statsByMonth[month] = { inc: 0, exp: 0 };
                    const amt = effectiveAmount(t);

                    if (amt > 0) {
                        statsByMonth[month].inc += amt;
                    } else {
                        const absAmt = Math.abs(amt);
                        statsByMonth[month].exp += absAmt;

                        // Recurring detection
                        const recKey = `${t.description.substring(0, 15)}-${Math.round(absAmt)}`;
                        if (!recurringMap[recKey]) recurringMap[recKey] = { count: 0, amt: absAmt, desc: t.description.substring(0, 25) };
                        recurringMap[recKey].count++;

                        // 50/30/20 classification
                        const cat = (t.category || '').toLowerCase();
                        if (['vivienda', 'alquiler', 'supermercado', 'hipoteca', 'luz', 'agua', 'gas', 'internet', 'seguros', 'salud', 'farmacia'].some(x => cat.includes(x))) {
                            catData.needs += absAmt;
                        } else if (['ocio', 'restaurante', 'compras', 'viajes', 'suscripciones', 'regalos', 'ropa', 'bar', 'cafe'].some(x => cat.includes(x))) {
                            catData.wants += absAmt;
                        } else {
                            catData.savings += absAmt;
                        }

                        // Category totals for top spending
                        const catName = t.category || 'Sin categoría';
                        if (!categoryTotals[catName]) categoryTotals[catName] = 0;
                        categoryTotals[catName] += absAmt;
                    }
                });

                const sortedMonths = Object.keys(statsByMonth).sort();
                if (!sortedMonths.length) return;

                const incomes = sortedMonths.map(m => statsByMonth[m].inc);
                const expenses = sortedMonths.map(m => statsByMonth[m].exp);
                const balances = sortedMonths.map((m, i) => incomes[i] - expenses[i]);

                const avgExp = expenses.reduce((a, b) => a + b, 0) / sortedMonths.length;
                const avgInc = incomes.reduce((a, b) => a + b, 0) / sortedMonths.length;
                const avgSave = balances.reduce((a, b) => a + b, 0) / sortedMonths.length;

                const lastM = sortedMonths[sortedMonths.length - 1];
                const lastInc = statsByMonth[lastM].inc;
                const lastExp = statsByMonth[lastM].exp;
                const lastBal = lastInc - lastExp;

                const currentAssets = DATA?.summary?.total_money || 0;
                const runway = avgExp > 0 ? (currentAssets / avgExp) : 0;
                const saveRate = avgInc > 0 ? (avgSave / avgInc * 100) : 0;

                // Subscriptions: appear 2+ months
                const subs = Object.values(recurringMap).filter(v => v.count >= 2).sort((a, b) => b.amt - a.amt);
                const subsTotal = subs.reduce((s, v) => s + v.amt, 0);

                // Health score
                const hs = Math.min(100, Math.round(Math.max(0, (runway / 6 * 30) + (saveRate * 1.2) + 15)));

                // Update KPIs
                set('f-runway', `${runway.toFixed(1)} meses`);
                set('f-saving-rate', `${saveRate.toFixed(1)}%`);
                set('f-burn-rate', eur(-avgExp));
                set('f-recurring', subs.length);
                set('f-recurring-count', `${eur(-subsTotal)}/mes detectados`);
                set('f-last-inc', eur(lastInc));
                set('f-last-exp', eur(-lastExp));
                const lastBalEl = document.getElementById('f-last-balance');
                lastBalEl.textContent = eur(lastBal);
                lastBalEl.className = 'kpi-val ' + (lastBal >= 0 ? 'up' : 'down');
                set('f-months-data', `${sortedMonths.length} meses`);
                document.getElementById('finance-health-score').innerHTML = `Salud Financiera: <span style="font-weight:800;font-size:16px">${hs}</span>/100`;

                document.getElementById('f-saving-foot').innerHTML = `<span class="badge ${saveRate > 20 ? 'up' : saveRate > 0 ? 'up' : 'down'}">${saveRate > 20 ? 'Excelente' : saveRate > 10 ? 'Bueno' : saveRate > 0 ? 'Mejorable' : 'Déficit'}</span>`;

                // 50/30/20
                renderRule503020(catData);

                // AI Insights
                generateFinanceInsights(runway, saveRate, subs.length, subsTotal, avgInc, avgExp, avgSave, sortedMonths.length, lastBal, categoryTotals);

                // Charts
                renderFinanceChart(sortedMonths, incomes, expenses);
                renderSavingTrend(sortedMonths, balances, avgSave);

                // Top categories
                renderTopCategories(categoryTotals);

                // Subscriptions
                renderSubscriptions(subs);

                // Milestones
                renderMilestones(currentAssets, avgSave, DATA?.summary?.total_invested || 0);

            } catch (err) { console.error('Error cargando inteligencia financiera:', err); }
        }

        function renderRule503020(cats) {
            const total = cats.needs + cats.wants + cats.savings || 1;
            const rows = [
                { label: 'Necesidades', goal: 50, p: cats.needs / total * 100, color: '#2563EB', hint: 'Vivienda, comida, servicios' },
                { label: 'Deseos', goal: 30, p: cats.wants / total * 100, color: '#8B5CF6', hint: 'Ocio, ropa, restaurantes' },
                { label: 'Ahorro / Inversión', goal: 20, p: cats.savings / total * 100, color: '#10B981', hint: 'Inversión, emergencias' }
            ];
            document.getElementById('rule-503020-container').innerHTML = rows.map(r => {
                const over = r.p > r.goal + 10, under = r.p < r.goal - 10;
                const status = over ? '🔴 Por encima' : under ? '🟡 Por debajo' : '🟢 En meta';
                return `
      <div class="rule-row">
        <div class="rule-head">
          <span style="font-weight:600">${r.label} <span style="color:var(--text-3);font-weight:400;font-size:11px">(meta ${r.goal}%)</span></span>
          <span style="font-family:'JetBrains Mono',monospace;font-weight:600">${r.p.toFixed(0)}% ${status}</span>
        </div>
        <div style="height:8px;background:var(--bg2);border-radius:4px;overflow:hidden;position:relative">
          <div style="position:absolute;top:0;left:0;height:100%;width:${r.goal}%;border-right:2px dashed rgba(0,0,0,0.2);pointer-events:none"></div>
          <div style="width:${Math.min(r.p, 100)}%;background:${r.color};height:100%;border-radius:4px;transition:width 1.2s"></div>
        </div>
        <div class="rule-meta">${r.hint} · ${eur(r.p / 100 * 1)} de cada €1 gastado</div>
      </div>`;
            }).join('');
        }

        async function generateFinanceInsights(runway, saveRate, subsCount, subsTotal, avgInc, avgExp, avgSave, months, lastBal, catTotals) {
            const list = document.getElementById('finance-insights-list');
            // Deterministic insights (no API needed — fast & reliable)
            const insights = [];

            if (runway < 3) insights.push({ icon: '⚠️', color: 'var(--red-bg)', text: `<strong>Alerta colchón financiero:</strong> Solo ${runway.toFixed(1)} meses de runway. Prioriza acumular al menos 6 meses de gastos en cuenta líquida antes de invertir más.` });
            else if (runway < 6) insights.push({ icon: '🛡️', color: '#FEF3C7', text: `Tu runway de <strong>${runway.toFixed(1)} meses</strong> es razonable pero puedes mejorarlo. Intenta llegar a 6 meses de colchón de emergencia.` });
            else insights.push({ icon: '✅', color: 'var(--green-bg)', text: `Excelente colchón de emergencia: <strong>${runway.toFixed(1)} meses</strong> cubiertos. Puedes ser más agresivo invirtiendo el exceso.` });

            if (saveRate > 25) insights.push({ icon: '🚀', color: 'var(--green-bg)', text: `Tasa de ahorro del <strong>${saveRate.toFixed(1)}%</strong> — sobresaliente. Automatiza las aportaciones a fondos para que el ahorro no requiera fuerza de voluntad.` });
            else if (saveRate > 10) insights.push({ icon: '📈', color: '#EFF6FF', text: `Ahorras el <strong>${saveRate.toFixed(1)}%</strong> de tus ingresos. Para escalar a >20%, revisa los gastos recurrentes de las categorías de "Deseos".` });
            else if (saveRate > 0) insights.push({ icon: '📊', color: '#FEF3C7', text: `Tasa de ahorro baja (<strong>${saveRate.toFixed(1)}%</strong>). Identifica la mayor categoría de gasto y trata de reducirla un 10% el próximo mes.` });
            else insights.push({ icon: '🔴', color: 'var(--red-bg)', text: `<strong>Déficit mensual detectado.</strong> Gastas más de lo que ingresas. Analiza el top de categorías y elimina o reduce gastos no esenciales urgentemente.` });

            if (subsCount > 0) insights.push({ icon: '📱', color: '#F5F3FF', text: `Hay <strong>${subsCount} suscripciones recurrentes</strong> que suman ~${eur(-subsTotal)}/mes. Revisa cuáles no usas activamente — eso es ~${eur(-subsTotal * 12)}/año.` });

            if (months >= 3) {
                const trend = lastBal > avgSave ? 'mejorando' : 'empeorando';
                const trendColor = lastBal > avgSave ? 'var(--green-bg)' : '#FEF3C7';
                insights.push({ icon: lastBal > avgSave ? '📉' : '📈', color: trendColor, text: `El último mes tu balance (<strong>${eur(lastBal)}</strong>) está <strong>${trend}</strong> respecto a tu promedio de ${eur(avgSave)}/mes.` });
            }

            list.innerHTML = insights.map(i => `
    <div class="insight-row">
      <div class="insight-icon" style="background:${i.color}">${i.icon}</div>
      <div class="insight-text">${i.text}</div>
    </div>`).join('');
        }

        function renderFinanceChart(labels, incomes, expenses) {
            const ctx = document.getElementById('financeChart').getContext('2d');
            if (financeChart) financeChart.destroy();
            financeChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels, datasets: [
                        { label: 'Ingresos', data: incomes, backgroundColor: 'rgba(21,128,61,0.65)', borderRadius: 4 },
                        { label: 'Gastos', data: expenses, backgroundColor: 'rgba(220,38,38,0.65)', borderRadius: 4 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'DM Sans', size: 12 }, boxWidth: 10 } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => eur(v), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } }, x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 } } } } }
            });
        }

        function renderSavingTrend(labels, balances, avg) {
            const ctx = document.getElementById('savingTrendChart').getContext('2d');
            if (savingTrendChart) savingTrendChart.destroy();
            savingTrendChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels, datasets: [
                        { label: 'Ahorro neto', data: balances, backgroundColor: balances.map(v => v >= 0 ? 'rgba(21,128,61,0.65)' : 'rgba(220,38,38,0.65)'), borderRadius: 4 },
                        { label: 'Promedio', data: labels.map(() => avg), type: 'line', borderColor: '#DC2626', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, fill: false }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'DM Sans', size: 12 }, boxWidth: 10 } } }, scales: { y: { ticks: { callback: v => eur(v), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } }, x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 } } } } }
            });
        }

        function renderTopCategories(catTotals) {
            const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);
            const max = sorted[0]?.[1] || 1;
            const catColors = ['#2563EB', '#7C3AED', '#0891B2', '#059669', '#D97706', '#DC2626', '#EC4899', '#6B7280'];
            document.getElementById('top-cats-list').innerHTML = sorted.map(([name, val], i) => `
    <div class="top-cat-row">
      <div class="top-cat-name">${name}</div>
      <div class="top-cat-bar-wrap"><div class="top-cat-bar"><div class="top-cat-fill" style="width:${(val / max * 100).toFixed(0)}%;background:${catColors[i % catColors.length]}"></div></div></div>
      <div class="top-cat-val down">${eur(-val)}</div>
    </div>`).join('');
        }

        function renderSubscriptions(subs) {
            const el = document.getElementById('subs-list');
            if (!subs.length) { el.innerHTML = '<p style="font-size:12px;color:var(--text-3);text-align:center;padding:20px">No se detectaron suscripciones</p>'; return; }
            el.innerHTML = subs.slice(0, 8).map(s => `
    <div class="sub-row">
      <div style="width:28px;height:28px;border-radius:7px;background:rgba(124,58,237,0.1);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">📱</div>
      <div class="sub-name">${s.desc}</div>
      <div class="sub-count">${s.count}×</div>
      <div class="sub-amount">${eur(-s.amt)}/mes</div>
    </div>`).join('');
        }

        function renderMilestones(currentAssets, avgSave, totalInvested) {
            const targets = [5000, 10000, 25000, 50000, 100000, 250000].filter(t => t > currentAssets);
            const list = document.getElementById('milestones-list');
            if (avgSave <= 0) { list.innerHTML = '<p style="font-size:12px;color:var(--text-3);text-align:center;padding:20px">Necesitas ahorro positivo para proyectar hitos.</p>'; return; }
            const colors = ['#2563EB', '#059669', '#7C3AED', '#D97706', '#0891B2'];
            list.innerHTML = targets.slice(0, 5).map((target, i) => {
                const needed = target - currentAssets;
                const months = needed / avgSave;
                const years = months / 12;
                const timeLabel = months < 2 ? `${Math.ceil(months)} mes` : months < 24 ? `${Math.ceil(months)} meses` : `${years.toFixed(1)} años`;
                const date = new Date(); date.setMonth(date.getMonth() + Math.ceil(months));
                const dateLabel = date.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
                return `<div class="milestone">
      <div class="milestone-dot" style="background:${colors[i % colors.length]}"></div>
      <div>
        <div class="milestone-label">${eur(target)}</div>
        <div class="milestone-sub">En ~${timeLabel} · ${dateLabel}</div>
      </div>
      <div class="milestone-right">${eur(needed)} restantes</div>
    </div>`;
            }).join('');
        }

        // ─── CATEGORY MANAGER ────────────────────────────────────
        function openCategoryModal() { document.getElementById('cat-ov').style.display = 'flex'; fetchCategories(); }
        function closeCatModal() { document.getElementById('cat-ov').style.display = 'none'; }
        async function fetchCategories() {
            const r = await fetch('/api/categories'); const cats = await r.json(); renderCategoryList(cats);
        }
        function renderCategoryList(cats) {
            const list = document.getElementById('cat-list'); list.innerHTML = '';
            cats.forEach(cat => {
                const div = document.createElement('div'); div.className = 'card'; div.style.padding = '16px'; div.style.border = `1px solid ${cat.color || 'var(--border)'}33`;
                let sh = cat.subcategories.map(s => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--bg);border-radius:5px;font-size:12px">
        <span>${s.name}</span>
        <div>
          <button onclick="renameSubcategory(${s.id}, '${s.name.replace(/'/g, "\\'")}')" style="border:none;background:none;cursor:pointer;color:var(--text-3);font-size:14px;margin-right:6px" title="Renombrar">✏️</button>
          <button onclick="deleteSubcategory(${s.id})" style="border:none;background:none;cursor:pointer;color:var(--red);font-size:15px" title="Eliminar">×</button>
        </div>
      </div>`).join('');
                div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-weight:700;color:${cat.color || 'var(--text)'}">${cat.name}</span>
        <div>
            <button onclick="renameCategory(${cat.id}, '${cat.name.replace(/'/g, "\\'")}')" style="border:none;background:none;cursor:pointer;color:var(--text-3);font-size:12px;margin-right:8px">✏️ Renombrar</button>
            <button onclick="deleteCategory(${cat.id})" style="border:none;background:none;cursor:pointer;color:var(--text-3);font-size:12px">🗑️ Eliminar</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${sh}
        <div style="display:flex;gap:4px">
          <input type="text" placeholder="Nueva..." id="new-sub-${cat.id}" class="form-input" style="font-size:11px;padding:6px 8px">
          <button onclick="addSubcategory(${cat.id})" class="btn-action btn-primary" style="padding:6px 10px">+</button>
        </div>
      </div>`;
                list.appendChild(div);
            });
        }
        async function renameCategory(id, currentName) {
            const newName = prompt('Introduce el nuevo nombre para la categoría:', currentName);
            if (!newName || newName === currentName) return;
            await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, name: newName }) });
            fetchCategories();
        }
        async function renameSubcategory(id, currentName) {
            const newName = prompt('Introduce el nuevo nombre para la subcategoría:', currentName);
            if (!newName || newName === currentName) return;
            await fetch('/api/subcategories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, name: newName }) });
            fetchCategories();
        }
        async function addCategory() { const n = document.getElementById('new-cat-name').value; if (!n) return; await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) }); document.getElementById('new-cat-name').value = ''; fetchCategories(); }
        async function deleteCategory(id) { if (!confirm('¿Seguro? Se borrarán sus subcategorías.')) return; await fetch(`/api/categories/${id}`, { method: 'DELETE' }); fetchCategories(); }
        async function addSubcategory(catId) { const inp = document.getElementById(`new-sub-${catId}`); const n = inp.value; if (!n) return; await fetch('/api/subcategories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, category_id: catId }) }); inp.value = ''; fetchCategories(); }
        async function deleteSubcategory(id) { await fetch(`/api/subcategories/${id}`, { method: 'DELETE' }); fetchCategories(); }

        // ─── ASSET MANAGER ───────────────────────────────────────
        let currentFilter = 'ALL', allConfigs = [];
        function openAssetManager() { document.getElementById('modal-manage').classList.add('open'); switchTab('list'); fetchConfigs(); }
        function closeAssetManager() { document.getElementById('modal-manage').classList.remove('open'); }
        function switchTab(tab) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-btn-${tab}`));
            document.getElementById('tab-list').style.display = tab === 'list' ? 'block' : 'none';
            document.getElementById('tab-add').style.display = tab === 'add' ? 'block' : 'none';
            if (tab === 'add') { document.getElementById('asset-form').reset(); document.getElementById('asset-id').value = ''; document.getElementById('btn-save-asset').textContent = 'Guardar Activo'; setSubtype('cash'); }
        }
        function setFilter(f) { currentFilter = f; renderConfigList(); }
        function setSubtype(st) {
            document.getElementById('asset-subtype').value = st;
            ['cash', 'market', 'indexa'].forEach(b => document.getElementById(`sub-btn-${b}`).classList.toggle('active', b === st));
            document.getElementById('market-fields').style.display = st === 'market' ? 'block' : 'none';
            document.getElementById('ticker-group').style.display = st === 'market' ? 'block' : 'none';
            document.getElementById('indexa-fields').style.display = st === 'indexa' ? 'block' : 'none';
            document.getElementById('cash-fields').style.display = st === 'cash' ? 'block' : 'none';
            
            const hl = document.getElementById('holdings-label'), hh = document.getElementById('holdings-hint'), ps = document.getElementById('asset-portfolio');
            if (st === 'cash') { hl.textContent = 'Saldo Total (Manual) o Base Inicial Mínima (€)'; hh.textContent = 'Indica el valor base si sincronizas, o el importe actual en cuenta.'; ps.value = 'CASH'; ps.disabled = true; toggleCashSync(); }
            else if (st === 'market') { hl.textContent = 'Unidades / Participaciones'; hh.textContent = 'Número de títulos o monedas.'; document.getElementById('asset-type').value = 'auto'; ps.disabled = false; }
            else { hl.textContent = 'Valor Actual (€)'; hh.textContent = 'Se actualizará automáticamente con el Token.'; ps.value = 'FUNDS'; ps.disabled = false; }
        }
        function toggleCashSync() {
            const mode = document.getElementById('cash-sync-mode').value;
            document.getElementById('cash-bank-group').style.display = mode === 'auto' ? 'block' : 'none';
            document.getElementById('asset-type').value = mode; 
        }
        async function fetchConfigs() { const r = await fetch('/api/configs'); allConfigs = await r.json(); renderConfigList(); }
        function renderConfigList() {
            const list = document.getElementById('asset-configs-list'), subNav = document.getElementById('sub-nav-list');
            const counts = { ALL: allConfigs.length, CASH: 0, FUNDS: 0, CRYPTO: 0, ETFS: 0, OTROS: 0 };
            allConfigs.forEach(c => { if (counts[c.portfolio] !== undefined) counts[c.portfolio]++; else counts.OTROS++; });
            const labels = { ALL: 'Todos', CASH: 'Efectivo', FUNDS: 'Fondos', CRYPTO: 'Crypto', ETFS: 'ETFs', OTROS: 'Otros' };
            subNav.innerHTML = ['ALL', 'CASH', 'FUNDS', 'CRYPTO', 'ETFS', 'OTROS'].map(f => `<button class="sub-btn ${currentFilter === f ? 'active' : ''}" onclick="setFilter('${f}')">${labels[f]} ${counts[f]}</button>`).join('');
            const fi = currentFilter === 'ALL' ? allConfigs : allConfigs.filter(c => c.portfolio === currentFilter || (currentFilter === 'OTROS' && !['CASH', 'FUNDS', 'CRYPTO', 'ETFS'].includes(c.portfolio)));
            list.innerHTML = fi.map(c => `
    <div class="config-item">
      <div><div style="font-weight:500">${c.name}</div><div style="font-size:11px;color:var(--text-3)">${c.portfolio} · ${c.subtype === 'market' ? (c.ticker || 'N/A') : c.subtype.toUpperCase()}</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn-action" onclick="editConfig(${c.id})" style="padding:4px 10px;font-size:11px">Editar</button>
        <button class="btn-action" onclick="deleteConfig(${c.id})" style="padding:4px 10px;font-size:11px;background:rgba(220,38,38,0.06);color:var(--red);border-color:rgba(220,38,38,0.15)">Borrar</button>
      </div>
    </div>`).join('') || '<div style="text-align:center;color:var(--text-3);padding:32px">No hay activos en esta categoría.</div>';
        }
        let searchTimeoutGlobal;
        function onSearchInput(val) {
            clearTimeout(searchTimeoutGlobal);
            if (val.length < 2) { document.getElementById('search-results').style.display = 'none'; return; }
            searchTimeoutGlobal = setTimeout(async () => {
                const port = document.getElementById('asset-portfolio').value;
                const r = await fetch(`/api/search?q=${val}&portfolio=${port}`); const results = await r.json();
                const container = document.getElementById('search-results');
                container.innerHTML = results.map(r => `<div class="search-item" onclick="selectTicker('${r.symbol}','${r.name}')"><b>${r.display_symbol || r.symbol}</b> — ${r.name} (${r.exch})</div>`).join('');
                container.style.display = results.length ? 'block' : 'none';
            }, 300);
        }
        function selectTicker(symbol, name) { document.getElementById('asset-ticker').value = symbol; document.getElementById('asset-name').value = name; document.getElementById('search-results').style.display = 'none'; }
        async function saveAsset() {
            let finalType = document.getElementById('asset-type').value || 'manual';
            let finalTicker = document.getElementById('asset-ticker').value;
            if (document.getElementById('asset-subtype').value === 'cash' && document.getElementById('cash-sync-mode').value === 'auto') {
                finalType = 'auto';
                finalTicker = document.getElementById('cash-bank-source').value;
            }
            const data = { id: document.getElementById('asset-id').value || null, name: document.getElementById('asset-name').value, portfolio: document.getElementById('asset-portfolio').value, subtype: document.getElementById('asset-subtype').value, type: finalType, ticker: finalTicker, holdings: document.getElementById('asset-holdings').value, invested_total: document.getElementById('asset-invested').value };
            const r = await fetch('/api/configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            if (r.ok) { switchTab('list'); fetchConfigs(); }
        }
        function editConfig(id) {
            const c = allConfigs.find(x => x.id === id); if (!c) return;
            switchTab('add');
            setTimeout(() => { 
                document.getElementById('asset-id').value = c.id; document.getElementById('asset-name').value = c.name; document.getElementById('asset-portfolio').value = c.portfolio; document.getElementById('asset-subtype').value = c.subtype; document.getElementById('asset-type').value = c.type; document.getElementById('asset-ticker').value = c.ticker || ''; document.getElementById('asset-holdings').value = c.holdings; document.getElementById('asset-invested').value = c.invested_total; 
                if (c.subtype === 'cash') {
                    document.getElementById('cash-sync-mode').value = c.type === 'auto' ? 'auto' : 'manual';
                    if (c.type === 'auto' && c.ticker) document.getElementById('cash-bank-source').value = c.ticker;
                }
                setSubtype(c.subtype || 'market');
                document.getElementById('btn-save-asset').textContent = 'Actualizar Activo'; 
            }, 10);
        }
        async function deleteConfig(id) { if (!confirm('¿Eliminar este activo?')) return; const r = await fetch(`/api/configs/${id}`, { method: 'DELETE' }); if (r.ok) fetchConfigs(); }

        // ─── SYNC ────────────────────────────────────────────────
        async function syncIndexa() {
            const btn = document.getElementById('btn-sync-all'), icon = document.getElementById('sync-icon-indexa');
            btn.style.opacity = '.6'; btn.style.pointerEvents = 'none'; icon.classList.add('spinning');
            try { await fetch('/api/sync/all', { method: 'POST' }); await init(); } catch (e) { }
            finally { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; icon.classList.remove('spinning'); }
        }

        // ════════════════════ MULTIVERSE LOGIC ════════════════════
        let activeVerse = 'startup';
        let multiverseChart = null;
        let hits = JSON.parse(localStorage.getItem('wealth_hitos') || '[]');

        function loadRetirementData() { 
            if (!DATA || !DATA.summary) return;
            renderHitos();
            updateMultiverse(); 
        }

        function fillFinancials(type) {
            if (!ALL_TRANSACTIONS || !ALL_TRANSACTIONS.length) return;
            const now = new Date();
            const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(now.getMonth() - 6);
            
            const months = {};
            ALL_TRANSACTIONS.forEach(t => {
                const d = new Date(t.date);
                if (d < sixMonthsAgo || t.category === 'Movimientos') return;
                const m = t.date.substring(0, 7);
                if (!months[m]) months[m] = { inc: 0, exp: 0 };
                if (t.amount > 0) months[m].inc += t.amount;
                else months[m].exp += Math.abs(t.amount);
            });
            
            const monthKeys = Object.keys(months);
            if (!monthKeys.length) return;
            
            const sumInc = monthKeys.reduce((s, k) => s + months[k].inc, 0);
            const sumExp = monthKeys.reduce((s, k) => s + months[k].exp, 0);
            
            if (type === 'income') document.getElementById('m-income').value = Math.round(sumInc / monthKeys.length);
            else if (type === 'expense') document.getElementById('m-spend').value = Math.round(sumExp / monthKeys.length);
            
            updateMultiverse();
        }

        function fillHistory(type) {
            if (!DATA || !DATA.history_global) return;
            const h = DATA.history_global;
            if (type === 'roi') {
                const globalMwr = DATA.summary.global_mwr || 7;
                document.getElementById('m-roi').value = globalMwr.toFixed(1);
            }
            updateMultiverse();
        }

        function addHito() {
            const name = document.getElementById('h-name').value;
            const val = parseFloat(document.getElementById('h-val').value);
            const date = document.getElementById('h-date').value;
            if (!name || isNaN(val) || !date) return;
            
            hits.push({ id: Date.now(), name, val, date });
            localStorage.setItem('wealth_hitos', JSON.stringify(hits));
            
            document.getElementById('h-name').value = '';
            document.getElementById('h-val').value = '';
            renderHitos();
            updateMultiverse();
        }

        function removeHito(id) {
            hits = hits.filter(h => h.id !== id);
            localStorage.setItem('wealth_hitos', JSON.stringify(hits));
            renderHitos();
            updateMultiverse();
        }

        function renderHitos() {
            const container = document.getElementById('hito-list');
            if (!container) return;
            container.innerHTML = hits.sort((a,b) => a.date.localeCompare(b.date)).map(h => `
                <div class="hito-item">
                    <div class="hito-info">
                        <div class="hito-icon">${h.isMonthly ? '🔄' : '✨'}</div>
                        <div>
                            <div class="hito-name">${h.name}</div>
                            <div class="hito-date">${h.isMonthly ? 'Desde ' : ''}${h.date}</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:12px">
                        <span style="font-weight:700; color:var(--red)">-${eur(h.val)}${h.isMonthly ? '/mes' : ''}</span>
                        <div class="hito-remove" onclick="removeHito(${h.id})">×</div>
                    </div>
                </div>
            `).join('');
        }

        function selectVerse(verse) {
            activeVerse = verse;
            document.querySelectorAll('.verse-card').forEach(c => c.classList.remove('active'));
            document.getElementById(`v-${verse}`).classList.add('active');
            updateMultiverse();
        }

        function updateMultiverse() {
            const income = parseFloat(document.getElementById('m-income').value) || 0;
            const incG = parseFloat(document.getElementById('m-inc-growth').value) || 0;
            const spend = parseFloat(document.getElementById('m-spend').value) || 0;
            const expG = parseFloat(document.getElementById('m-exp-growth').value) || 0;
            const roi = parseFloat(document.getElementById('m-roi').value) || 7;
            const investRate = parseFloat(document.getElementById('m-invest-rate').value) || 80;
            const extraSave = parseFloat(document.getElementById('m-save').value) || 0;
            const years = parseInt(document.getElementById('m-years').value) || 20;
            
            const totalWealth = DATA?.summary?.total_money || 0;
            const realRoi = roi / 100;

            // --- 🚀 RUNWAY (Startup Mode) ---
            let runwayWealth = totalWealth;
            let monthsRunway = 0;
            const now = new Date();
            for(let m=1; m<=600; m++) { 
                const cur = new Date(now.getFullYear(), now.getMonth() + m);
                const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
                
                const curExp = spend * Math.pow(1 + (expG/100), m/12);
                const hitoTotal = hits.filter(h => !h.isMonthly && h.date === dateStr).reduce((s, h) => s + h.val, 0);
                const recurTotal = hits.filter(h => h.isMonthly && dateStr >= h.date).reduce((s, h) => s + h.val, 0);
                
                runwayWealth -= hitoTotal;
                runwayWealth -= (curExp + recurTotal);
                if (runwayWealth <= 0) { monthsRunway = m; break; }
            }
            document.getElementById('stat-runway').textContent = `${monthsRunway} meses`;
            document.getElementById('runway-bar').style.width = `${Math.min(100, (monthsRunway / 48) * 100)}%`;

            // --- 🌍 NOMAD MODE ---
            const monthlySWR = (totalWealth * 0.04) / 12;
            const checkTier = (id, cost) => {
                const el = document.getElementById(id);
                if (monthlySWR >= cost) { el.textContent = 'Free'; el.className = 'tier-unlocked'; }
                else { el.textContent = `-${eur(cost - monthlySWR)}`; el.className = 'tier-locked'; }
            };
            checkTier('tier-sea', 1000);
            checkTier('tier-ee', 1600);
            checkTier('tier-es', 2400);

            // --- ⌛ GAP YEAR ---
            const gapFutureCost = (spend * 12) * Math.pow(1 + (roi/100), 20); 
            document.getElementById('stat-gap-cost').textContent = eur(gapFutureCost);

            // --- 🌱 COMPOUNDER ---
            let compWealth = totalWealth;
            for(let i=0; i<years; i++) compWealth *= (1 + realRoi);
            document.getElementById('stat-comp-final').textContent = eur(compWealth);

            // --- CHART PROJECTION ---
            renderMultiverseChart(totalWealth, income, incG, spend, expG, extraSave, realRoi, investRate, years);
            updateInsight(activeVerse, monthsRunway, monthlySWR, gapFutureCost, compWealth);
        }

        function updateInsight(verse, runway, swr, gap, comp) {
            const el = document.getElementById('multiverse-insight');
            const insights = {
                startup: `En modo <b>Runway</b>, podrías sobrevivir <b>${runway} meses</b> sin ingresos. Al final, tu gasto mensual proyectado será de ${eur(parseFloat(document.getElementById('m-spend').value) * Math.pow(1+(parseFloat(document.getElementById('m-exp-growth').value)/100), runway/12))}.`,
                nomad: `Con tu capital actual, puedes extraer con seguridad <b>${eur(swr)}/mes</b>. Esto cubriría un estilo de vida nómada básico inmediatamente.`,
                gap: `Un año sabático hoy tiene un coste total de oportunidad de <b>${eur(gap)}</b> en tu patrimonio futuro proyectado a 20 años.`,
                compound: `Si dejaras de ahorrar hoy mismo, el interés compuesto llevaría tu capital hasta los <b>${eur(comp)}</b> en el horizonte seleccionado.`
            };
            el.innerHTML = insights[verse] || 'Selecciona un escenario para ver el impacto.';
        }

        function renderMultiverseChart(initial, income, incG, spend, expG, extra, roi, investRate, years) {
            const ctx = document.getElementById('multiverseChart')?.getContext('2d');
            if (!ctx) return;
            if (multiverseChart) multiverseChart.destroy();

            const labels = [];
            const dataBase = [];
            const dataVerse = [];
            
            let currentBase = initial;
            let currentVerse = initial;
            const now = new Date();

            for (let y = 0; y <= years; y++) {
                labels.push(`${y}a`);
                
                for (let m = 0; m < 12; m++) {
                    if (y === 0 && m === 0) continue; 
                    const cur = new Date(now.getFullYear(), now.getMonth() + (y * 12) + m);
                    const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
                    
                    const hitoTotal = hits.filter(h => !h.isMonthly && h.date === dateStr).reduce((s, h) => s + h.val, 0);
                    const recurTotal = hits.filter(h => h.isMonthly && dateStr >= h.date).reduce((s, h) => s + h.val, 0);
                    
                    const curInc = income * Math.pow(1 + (incG/100), (y*12+m)/12);
                    const curExp = (spend + recurTotal) * Math.pow(1 + (expG/100), (y*12+m)/12);
                    const curSave = (curInc - curExp) + extra;

                    // Standard (Realistic)
                    let monthlyInvested = Math.max(0, curSave * (investRate / 100));
                    let monthlyLiquid = curSave - monthlyInvested;
                    currentBase = (currentBase + monthlyInvested) * (1 + (roi/12)) + monthlyLiquid;
                    currentBase -= hitoTotal;

                    // Alternative
                    if (activeVerse === 'startup') {
                        currentVerse = Math.max(0, currentVerse - (curExp + hitoTotal));
                    } else if (activeVerse === 'compound') {
                        currentVerse = currentVerse * (1 + (roi/12)) - hitoTotal;
                    } else if (activeVerse === 'gap') {
                        if (y === 0) currentVerse = (currentVerse - (curExp + hitoTotal));
                        else currentVerse = (currentVerse + monthlyInvested) * (1 + (roi/12)) + monthlyLiquid - hitoTotal;
                    } else {
                        currentVerse = currentBase;
                    }
                }
                dataBase.push(Math.round(currentBase));
                dataVerse.push(Math.round(currentVerse));
            }

            multiverseChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Proyección Realista', data: dataBase, borderColor: 'rgba(156, 163, 175, 0.4)', borderDash: [5,5], pointRadius: 0, fill: false, tension: 0.3 },
                        { label: 'Escenario Seleccionado', data: dataVerse, borderColor: '#2563EB', backgroundColor: 'rgba(37, 99, 235, 0.08)', fill: true, tension: 0.4, pointRadius: 0 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { 
                        legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 12, usePointStyle: true, font: { family: 'Inter', size: 11 } } },
                        tooltip: { 
                            backgroundColor: '#0E0D0B', 
                            titleFont: { size: 13, weight: 'bold' },
                            bodyFont: { size: 12 },
                            padding: 12, 
                            cornerRadius: 8,
                            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${eur(ctx.raw)}` }
                        }
                    },
                    scales: { 
                        y: { beginAtZero: false, ticks: { callback: v => eur(v), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.03)' }, border: { display: false } },
                        x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 10 } } }
                    }
                }
            });
        }

        init();