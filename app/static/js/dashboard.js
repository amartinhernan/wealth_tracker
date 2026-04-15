// --- HELPERS GLOBALES ---
const eur = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const pct = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

let DATA, ALL_TXS = [];
let financeChart = null;
let activePorts = new Set(['CASH', 'CRYPTO', 'FUNDS', 'ETFS']);
let tRange = 'ALL';

async function init() {
    try {
        const resp = await fetch('/api/data');
        DATA = await resp.json();
        if (DATA.error) return;

        updateGlobalStats();
        renderTrend();
        renderDonut();
        renderTable();
        showPage('dashboard');
    } catch (e) { console.error("Error inicializando:", e); }
}

function showPage(page) {
    ['dashboard', 'transactions', 'finanzas'].forEach(p => {
        document.getElementById(`page-${p}`).style.display = p === page ? 'block' : 'none';
        document.getElementById(`nav-${p}`).classList.toggle('active', p === page);
    });

    if (page === 'transactions') fetchTransactions();
    if (page === 'finanzas') loadFinanceIntelligence();
}

// --- INTELIGENCIA FINANCIERA (EL MOTOR REAL) ---
async function loadFinanceIntelligence() {
    const resp = await fetch('/api/transactions');
    ALL_TXS = await resp.json();

    // 1. Limpieza y Agrupación
    const monthly = {};
    const catAnalysis = { needs: 0, wants: 0, savings: 0 };
    const recurringMap = {}; // Para detectar suscripciones

    ALL_TXS.forEach(t => {
        if (t.category === 'Movimientos') return;

        const month = t.date.substring(0, 7); // YYYY-MM
        if (!monthly[month]) monthly[month] = { inc: 0, exp: 0 };

        if (t.amount > 0) {
            monthly[month].inc += t.amount;
        } else {
            const amt = Math.abs(t.amount);
            monthly[month].exp += amt;

            // Detección de Recurrentes (Heurística: misma descripción e importe similar)
            const recKey = `${t.description.substring(0, 12)}-${Math.round(amt)}`;
            recurringMap[recKey] = (recurringMap[recKey] || 0) + 1;

            // Clasificación 50/30/20 pro categorías
            const cat = (t.category || 'Otros').toLowerCase();
            if (['vivienda', 'alquiler', 'supermercado', 'luz', 'agua', 'gas', 'internet', 'seguros', 'salud'].some(x => cat.includes(x))) {
                catAnalysis.needs += amt;
            } else if (['ocio', 'restaurante', 'compras', 'viajes', 'suscripciones', 'regalos'].some(x => cat.includes(x))) {
                catAnalysis.wants += amt;
            } else {
                catAnalysis.savings += amt;
            }
        }
    });

    const monthsArr = Object.keys(monthly).sort();
    const lastMonth = monthly[monthsArr[monthsArr.length - 1]] || { inc: 0, exp: 0 };

    // 2. Cálculos de Supervivencia y Salud
    const avgExpense = monthsArr.reduce((s, m) => s + monthly[m].exp, 0) / monthsArr.length;
    const runway = DATA.summary.total_money / avgExpense;
    const saveRate = lastMonth.inc > 0 ? ((lastMonth.inc - lastMonth.exp) / lastMonth.inc * 100) : 0;

    // 3. UI Finanzas
    document.getElementById('f-runway').textContent = runway.toFixed(1) + ' meses';
    document.getElementById('f-saving-rate').textContent = saveRate.toFixed(1) + '%';
    document.getElementById('f-burn-rate').textContent = eur(-avgExpense);

    const badge = document.getElementById('f-saving-badge');
    badge.innerHTML = `<span class="badge ${saveRate > 20 ? 'up' : (saveRate > 0 ? 'up' : 'down')}">${saveRate > 0 ? 'Ahorro Positivo' : 'Déficit'}</span>`;

    // Detectar suscripciones reales (aparecen 3 meses o más)
    const subsCount = Object.values(recurringMap).filter(v => v >= 2).length;
    document.getElementById('f-recurring').textContent = subsCount;
    document.getElementById('f-recurring-count').textContent = `${subsCount} servicios detectados mes a mes`;

    // Health Score (0-100) basado en runway (40%), tasa ahorro (40%) y diversificación (20%)
    const health = Math.round(Math.min(100, (runway / 12 * 40) + (saveRate * 1.5) + 20));
    document.getElementById('f-health-score').textContent = isNaN(health) ? 0 : health;

    // Renderizado de la Regla 50/30/20
    renderRule503020(catAnalysis, lastMonth.inc);
    renderFinanceChart(monthsArr, monthly);
    generateAIInsight(runway, saveRate, subsCount);
}

function renderRule503020(cats, income) {
    const total = cats.needs + cats.wants + cats.savings || 1;
    const container = document.getElementById('rule-503020');

    const rows = [
        { label: 'Necesidades (Meta 50%)', val: cats.needs, p: (cats.needs / total * 100), color: 'var(--accent)' },
        { label: 'Deseos (Meta 30%)', val: cats.wants, p: (cats.wants / total * 100), color: '#8B5CF6' },
        { label: 'Ahorro/Inversión (Meta 20%)', val: cats.savings, p: (cats.savings / total * 100), color: 'var(--green)' }
    ];

    container.innerHTML = rows.map(r => `
        <div style="margin-bottom:20px">
            <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; margin-bottom:6px">
                <span>${r.label}</span><span>${r.p.toFixed(0)}%</span>
            </div>
            <div class="rule-bar"><div class="rule-fill" style="width:${r.p}%; background:${r.color}"></div></div>
        </div>
    `).join('');
}

function generateAIInsight(runway, saveRate, subs) {
    const el = document.getElementById('finance-insight');
    if (runway < 3) el.textContent = "⚠️ Alerta: Tu colchón financiero es de menos de 3 meses. Prioriza el ahorro líquido antes de invertir más.";
    else if (saveRate < 10) el.textContent = "📊 Tu tasa de ahorro es baja. Intenta revisar esos " + subs + " pagos recurrentes para liberar flujo de caja.";
    else if (saveRate > 25) el.textContent = "🚀 ¡Excelente salud! Estás ahorrando más del 25%. Es el momento ideal para automatizar aportaciones a fondos.";
    else el.textContent = "✅ Tus finanzas están equilibradas. Mantén el control de tus gastos variables para no desviarte de la regla 50/30/20.";
}

function renderFinanceChart(labels, data) {
    const ctx = document.getElementById('financeChart').getContext('2d');
    if (financeChart) financeChart.destroy();
    financeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Ingresos', data: labels.map(l => data[l].inc), backgroundColor: 'rgba(16, 185, 129, 0.6)', borderRadius: 5 },
                { label: 'Gastos', data: labels.map(l => data[l].exp), backgroundColor: 'rgba(239, 68, 68, 0.6)', borderRadius: 5 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
    });
}

// --- GESTIÓN DE TRANSACCIONES ---
async function fetchTransactions() {
    const resp = await fetch('/api/transactions');
    ALL_TXS = await resp.json();
    renderTransactionsTable();
}

function renderTransactionsTable() {
    const tbody = document.getElementById('tbody-transactions');
    const query = document.getElementById('tx-search').value.toLowerCase();
    const type = document.getElementById('filter-type').value;
    const status = document.getElementById('filter-status').value;

    const filtered = ALL_TXS.filter(t => {
        const matchesSearch = t.description.toLowerCase().includes(query) || (t.category || '').toLowerCase().includes(query);
        const matchesType = type === 'ALL' || (type === 'INC' ? t.amount > 0 : t.amount < 0);
        const matchesStatus = status === 'ALL' || (status === 'PENDING' && !t.is_reviewed);
        return matchesSearch && matchesType && matchesStatus;
    });

    tbody.innerHTML = filtered.map(t => `
        <tr draggable="true" ondragstart="event.dataTransfer.setData('text/plain', ${t.id}); document.getElementById('unlink-zone').classList.add('visible')" ondragend="document.getElementById('unlink-zone').classList.remove('visible')">
            <td style="color:var(--text-sec); font-size:12px">${t.date}</td>
            <td><span class="badge-source">${t.source}</span></td>
            <td style="font-weight:600">${t.description}</td>
            <td style="text-align:right; font-weight:700" class="${t.amount > 0 ? 'up' : 'down'}">${t.amount.toFixed(2)}€</td>
            <td><span class="pill" style="font-size:11px">${t.category || 'Otros'}</span></td>
            <td style="text-align:center">
                <span class="badge" style="background:${t.is_reviewed ? '#D1FAE5' : '#F3F4F6'}; color:${t.is_reviewed ? '#065F46' : '#6B7280'}">
                    ${t.is_reviewed ? 'Revisado' : 'IA'}
                </span>
            </td>
            <td style="text-align:right">
                <button onclick="deleteTransaction(${t.id})" style="border:none; background:none; cursor:pointer; color:var(--text-sec)">×</button>
            </td>
        </tr>
    `).join('');
}

// --- OTROS RENDERS DASHBOARD ---
function updateGlobalStats() {
    const s = DATA.summary;
    document.getElementById('k-total').textContent = eur(s.total_money);
    document.getElementById('k-profit').textContent = eur(s.total_profit);
    document.getElementById('k-twr').textContent = pct(s.global_twr);
    document.getElementById('k-mwr').textContent = pct(s.global_mwr);
    document.getElementById('date-pill').textContent = s.date;
    document.getElementById('sfoot').textContent = `Actualizado: ${s.date}`;
}

let searchTimeout;
function debouncedRenderTransactions() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(renderTransactionsTable, 300);
}

// Iniciar aplicación
init();