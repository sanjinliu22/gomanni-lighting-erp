/* ================================================================
   哥曼尼照明 — 灯具批发零售管理系统 (Gomani Lighting ERP)  v2.1
   后端：Express + SQLite  |  实时同步：SSE  |  多人协作
   ================================================================ */

// ==================== API 层 ====================
const API_BASE = window.location.origin + '/api';

async function api(path, options = {}) {
  const url = API_BASE + path;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  try {
    const res = await fetch(url, config);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `请求失败: ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    console.error('API Error:', e.message);
    throw e;
  }
}

// ==================== 内存数据缓存 ====================
// 所有数据从后端加载，缓存在内存中，实时刷新
let _cache = {
  products: [], suppliers: [], customers: [], users: [],
  purchaseOrders: [], salesOrders: [], inventoryLogs: []
};
let _cacheLoaded = false;

// 服务信息（局域网 IP 等），由后端上报，用于生成手机可扫码的分享链接
let _serverInfo = null;

// 兼容旧代码的 getDB() — 返回内存缓存
function getDB() { return _cache; }

// 旧 saveDB 改为 no-op（数据通过 API 持久化到 SQLite）
function saveDB() { /* no-op — 数据由后端 SQLite 管理 */ }

function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }

// ==================== 数据加载 ====================
async function loadAllData() {
  try {
    const [products, suppliers, customers, users, purchaseOrders, salesOrders, inventoryLogs, serverInfo] = await Promise.all([
      api('/products'),
      api('/suppliers'),
      api('/customers'),
      api('/users'),
      api('/purchase-orders'),
      api('/sales-orders'),
      api('/inventory-logs'),
      api('/server-info').catch(() => null)
    ]);
    if (serverInfo) _serverInfo = serverInfo;
    _cache = { products, suppliers, customers, users, purchaseOrders, salesOrders, inventoryLogs };
    _cacheLoaded = true;
  } catch (e) {
    console.error('数据加载失败，使用本地兜底:', e.message);
    // 兜底：使用 localStorage 旧数据
    try {
      const raw = localStorage.getItem('gmny_light_data');
      if (raw) {
        const old = JSON.parse(raw);
        _cache = { ..._cache, ...old };
        _cacheLoaded = true;
      }
    } catch (e2) { /* ignore */ }
    if (!_cacheLoaded) {
      _cache = { products: [], suppliers: [], customers: [], users: [
        { id: 'admin', name: '管理员', role: '系统管理员', permissions: ['all'] },
        { id: 'guest', name: '访客', role: '只读用户', permissions: ['view'] }
      ], purchaseOrders: [], salesOrders: [], inventoryLogs: [] };
      _cacheLoaded = true;
    }
  }
}

// ==================== 实时同步 (SSE) ====================
function initRealtimeSync() {
  try {
    const source = new EventSource(API_BASE + '/events');
    source.addEventListener('product_updated', () => refreshData(['products']));
    source.addEventListener('supplier_updated', () => refreshData(['suppliers']));
    source.addEventListener('customer_updated', () => refreshData(['customers']));
    source.addEventListener('order_updated', () => refreshData(['purchaseOrders', 'salesOrders']));
    source.addEventListener('inventory_updated', () => refreshData(['products', 'inventoryLogs']));
    source.onerror = () => { /* 静默重连 */ };
  } catch (e) { /* SSE 不可用时静默降级 */ }
}

async function refreshData(tables) {
  try {
    const fetches = {};
    if (tables.includes('products')) fetches.products = api('/products');
    if (tables.includes('suppliers')) fetches.suppliers = api('/suppliers');
    if (tables.includes('customers')) fetches.customers = api('/customers');
    if (tables.includes('users')) fetches.users = api('/users');
    if (tables.includes('purchaseOrders')) fetches.purchaseOrders = api('/purchase-orders');
    if (tables.includes('salesOrders')) fetches.salesOrders = api('/sales-orders');
    if (tables.includes('inventoryLogs')) fetches.inventoryLogs = api('/inventory-logs');

    const keys = Object.keys(fetches);
    const results = await Promise.all(Object.values(fetches));
    keys.forEach((k, i) => { _cache[k] = results[i]; });

    // 仅在有页面内容时刷新
    if (currentPage && typeof window['render' + currentPage.charAt(0).toUpperCase() + currentPage.slice(1)] === 'function') {
      // 不对应页面刷新，只更新导航徽章
    }
    updateNavBadges(_cache);
  } catch (e) { /* 静默失败 */ }
}

// ==================== 工具函数 ====================
function formatMoney(n) {
  return '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function formatDateShort(ts) {
  const d = new Date(ts);
  return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getNextOrderNo(prefix, orders) {
  const today = new Date();
  const year = today.getFullYear();
  const existing = orders.filter(o => o.orderNo && o.orderNo.startsWith(`${prefix}-${year}-`));
  const maxNum = existing.reduce((max, o) => {
    const num = parseInt(o.orderNo.split('-')[2]);
    return num > max ? num : max;
  }, 0);
  return `${prefix}-${year}-${String(maxNum + 1).padStart(4, '0')}`;
}

// ==================== Toast ====================
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => { toast.className = 'toast'; }, 2500);
}

// ==================== 当前用户与路由 ====================
let currentUser = null;
let currentPage = 'dashboard';

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').style.display = 'none';

  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'products': renderProducts(); break;
    case 'suppliers': renderSuppliers(); break;
    case 'customers': renderCustomers(); break;
    case 'purchase': renderPurchaseOrders(); break;
    case 'sales': renderSalesOrders(); break;
    case 'inventory': renderInventory(); break;
    case 'reports': renderReports(); break;
    case 'settings': renderSettings(); break;
  }
}

// ==================== 仪表盘 ====================
function renderDashboard() {
  const db = getDB();
  const now = Date.now();
  const day = 86400000;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

  const completedSales = db.salesOrders.filter(o => o.status === 'completed');
  const todaySales = completedSales.filter(o => {
    const ut = typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt;
    return ut > now - day;
  });
  const monthSales = completedSales.filter(o => {
    const ut = typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt;
    return ut >= monthStart;
  });

  const completedPurchase = db.purchaseOrders.filter(o => o.status === 'received');
  const todayPurchase = completedPurchase.filter(o => {
    const ut = typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt;
    return ut > now - day;
  });
  const monthPurchase = completedPurchase.filter(o => {
    const ut = typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt;
    return ut >= monthStart;
  });

  const todaySaleTotal = todaySales.reduce((s, o) => s + o.totalAmount, 0);
  const monthSaleTotal = monthSales.reduce((s, o) => s + o.totalAmount, 0);
  const todayPurchaseTotal = todayPurchase.reduce((s, o) => s + o.totalAmount, 0);
  const monthPurchaseTotal = monthPurchase.reduce((s, o) => s + o.totalAmount, 0);

  const confirmedSales = db.salesOrders.filter(o => o.status === 'confirmed' || o.status === 'shipped');
  const receivableTotal = confirmedSales.reduce((s, o) => s + o.totalAmount, 0);
  const confirmedPurchase = db.purchaseOrders.filter(o => o.status === 'confirmed');
  const payableTotal = confirmedPurchase.reduce((s, o) => s + o.totalAmount, 0);

  const lowStockCount = db.products.filter(p => p.stock < ms(p)).length;

  // 最近活动
  const recentActivities = [
    ...db.salesOrders.map(o => ({ type: 'sale', order: o, time: typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt })),
    ...db.purchaseOrders.map(o => ({ type: 'purchase', order: o, time: typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt })),
  ].sort((a, b) => b.time - a.time).slice(0, 10);

  // 毛利率
  let totalCost = 0, totalRevenue = 0;
  completedSales.forEach(so => {
    so.items.forEach(item => {
      const product = db.products.find(p => p.id === item.productId);
      if (product) {
        const pp = typeof product.purchasePrice === 'number' ? product.purchasePrice : product.purchase_price;
        totalCost += pp * item.quantity;
        totalRevenue += item.total;
      }
    });
  });
  const grossProfit = totalRevenue - totalCost;
  const grossMargin = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0';

  const html = `
    <div class="page-header">
      <div>
        <h2>📊 仪表盘</h2>
        <p style="color:var(--gray-500);font-size:13px;margin-top:4px;">欢迎回来，${currentUser ? currentUser.name : '用户'} — ${currentUser ? currentUser.role : ''}</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-outline" onclick="navigateTo('purchase')">📥 新建采购单</button>
        <button class="btn btn-primary" onclick="navigateTo('sales')">📤 新建销售单</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-card-icon blue">💰</div>
          <span class="stat-card-label">今日销售额</span>
        </div>
        <div class="stat-card-value">${formatMoney(todaySaleTotal)}</div>
        <div class="stat-card-change up">📈 本月: ${formatMoney(monthSaleTotal)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-card-icon orange">🛒</div>
          <span class="stat-card-label">今日采购额</span>
        </div>
        <div class="stat-card-value">${formatMoney(todayPurchaseTotal)}</div>
        <div class="stat-card-change">📋 本月: ${formatMoney(monthPurchaseTotal)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-card-icon green">📊</div>
          <span class="stat-card-label">毛利润 / 毛利率</span>
        </div>
        <div class="stat-card-value">${formatMoney(grossProfit)}</div>
        <div class="stat-card-change up">📈 毛利率: ${grossMargin}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-card-icon red">⚠️</div>
          <span class="stat-card-label">库存预警</span>
        </div>
        <div class="stat-card-value">${lowStockCount}</div>
        <div class="stat-card-change down">个商品低于安全库存</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-card-icon blue">📥</div>
          <span class="stat-card-label">应收账款</span>
        </div>
        <div class="stat-card-value">${formatMoney(receivableTotal)}</div>
        <div class="stat-card-change">待收: ${confirmedSales.length} 笔</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <div class="stat-card-icon orange">📤</div>
          <span class="stat-card-label">应付账款</span>
        </div>
        <div class="stat-card-value">${formatMoney(payableTotal)}</div>
        <div class="stat-card-change">待付: ${confirmedPurchase.length} 笔</div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-container">
        <h3>📈 近30天销售/采购趋势</h3>
        <div class="chart-wrapper"><canvas id="trendChart"></canvas></div>
      </div>
      <div class="chart-container">
        <h3>📦 商品库存占比</h3>
        <div class="chart-wrapper"><canvas id="stockChart"></canvas></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>🕐 最近动态</h3></div>
      <div class="card-body" style="padding:0;">
        <div class="table-container">
          <table>
            <thead><tr><th>时间</th><th>类型</th><th>单号</th><th>金额</th><th>状态</th><th>操作人</th></tr></thead>
            <tbody>
              ${recentActivities.map(a => {
                const isSale = a.type === 'sale';
                const custOrSupp = isSale
                  ? (db.customers.find(c => c.id === a.order.customerId) || { name: '-' }).name
                  : (db.suppliers.find(s => s.id === a.order.supplierId) || { name: '-' }).name;
                return `
                <tr>
                  <td>${formatDateShort(a.time)}</td>
                  <td>${isSale ? '<span style="color:var(--success)">📤 销售</span>' : '<span style="color:var(--primary)">📥 采购</span>'}</td>
                  <td><strong>${a.order.orderNo}</strong> (${custOrSupp})</td>
                  <td class="amount">${formatMoney(a.order.totalAmount)}</td>
                  <td><span class="status-tag ${a.order.status}">${statusLabel(a.order.status)}</span></td>
                  <td>${db.users.find(u => u.id === a.order.createdBy)?.name || '-'}</td>
                </tr>`;
              }).join('')}
              ${recentActivities.length === 0 ? '<tr><td colspan="6"><div class="empty-state"><p>暂无动态</p></div></td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('mainContent').innerHTML = html;

  setTimeout(() => {
    renderTrendChart(db);
    renderStockChart(db);
  }, 100);

  updateNavBadges(db);
}

function statusLabel(s) {
  const map = { draft:'草稿', confirmed:'已确认', received:'已入库', shipped:'已发货', completed:'已完成', cancelled:'已取消' };
  return map[s] || s;
}

function renderTrendChart(db) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;
  const now = Date.now();
  const day = 86400000;
  const labels = [];
  const saleData = [];
  const purchaseData = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * day);
    labels.push(`${d.getMonth()+1}/${d.getDate()}`);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + day;
    saleData.push(
      db.salesOrders.filter(o => {
        const ut = typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt;
        return o.status === 'completed' && ut >= dayStart && ut < dayEnd;
      }).reduce((s, o) => s + o.totalAmount, 0)
    );
    purchaseData.push(
      db.purchaseOrders.filter(o => {
        const ut = typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt;
        return o.status === 'received' && ut >= dayStart && ut < dayEnd;
      }).reduce((s, o) => s + o.totalAmount, 0)
    );
  }
  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '销售额', data: saleData, borderColor: '#e53e3e', backgroundColor: 'rgba(229,62,62,0.05)', fill: true, tension: 0.4, pointRadius: 2 },
        { label: '采购额', data: purchaseData, borderColor: '#1a73e8', backgroundColor: 'rgba(26,115,232,0.05)', fill: true, tension: 0.4, pointRadius: 2 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { ticks: { callback: v => (v/10000).toFixed(0)+'万' } } }
    }
  });
}

function renderStockChart(db) {
  const canvas = document.getElementById('stockChart');
  if (!canvas) return;
  const categories = [...new Set(db.products.map(p => p.category))];
  const data = categories.map(cat =>
    db.products.filter(p => p.category === cat).reduce((s, p) => s + p.stock, 0)
  );
  const colors = ['#1a73e8', '#0d9e6c', '#f59e0b', '#e53e3e', '#8b5cf6', '#ec4899'];
  new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: categories,
      datasets: [{ data, backgroundColor: colors.slice(0, categories.length), borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} 件` } } }
    }
  });
}

function updateNavBadges(db) {
  const pendingPO = db.purchaseOrders.filter(o => o.status === 'draft' || o.status === 'confirmed').length;
  const pendingSO = db.salesOrders.filter(o => o.status === 'draft' || o.status === 'confirmed').length;
  const lowStock = db.products.filter(p => p.stock < ms(p)).length;

  const pb = document.getElementById('purchaseBadge');
  const sb = document.getElementById('salesBadge');
  const iw = document.getElementById('inventoryWarn');
  if (pb) pb.textContent = pendingPO;
  if (sb) sb.textContent = pendingSO;
  if (iw) iw.textContent = lowStock;
  if (iw) iw.style.display = lowStock > 0 ? '' : 'none';
}

// 获取实际字段名（兼容 DB 列名 vs JS camelCase）
function sp(obj) { return typeof obj.salePrice === 'number' ? obj.salePrice : (obj.sale_price || 0); }
function pp(obj) { return typeof obj.purchasePrice === 'number' ? obj.purchasePrice : (obj.purchase_price || 0); }
function wp(obj) { return typeof obj.wholesalePrice === 'number' ? obj.wholesalePrice : (obj.wholesale_price || 0); }
function ms(obj) { return typeof obj.minStock === 'number' ? obj.minStock : (obj.min_stock || 0); }

// 客户类型标签
function ctypeLabel(c) {
  return c.type === 'wholesale'
    ? '<span style="background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:10px;font-size:12px;white-space:nowrap;">批发客户</span>'
    : '<span style="background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:10px;font-size:12px;white-space:nowrap;">零售客户</span>';
}

// 客户类型：wholesale 批发 / retail 零售
function ctype(c) { return (c && c.type === 'wholesale') ? 'wholesale' : 'retail'; }

// ==================== 商品管理 ====================
function renderProducts() {
  const db = getDB();
  const html = `
    <div class="page-header">
      <h2>📦 商品管理</h2>
      <div class="page-header-actions">
        <button class="btn btn-primary" onclick="showAddProductModal()">+ 新增商品</button>
      </div>
    </div>
    <div class="card"><div class="card-body">
      <div class="search-bar">
        <div class="search-input-wrapper">
          <span class="search-icon">🔍</span>
          <input type="text" class="form-input" id="productSearch" placeholder="搜索商品名称/编码..." oninput="filterProducts()">
        </div>
        <select class="form-select" id="productCatFilter" onchange="filterProducts()">
          <option value="">全部分类</option>
          ${[...new Set(db.products.map(p => p.category))].map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
        <select class="form-select" id="productStockFilter" onchange="filterProducts()">
          <option value="">全部库存状态</option><option value="low">库存预警</option><option value="normal">库存正常</option>
        </select>
      </div>
      <div class="table-container"><table>
        <thead><tr><th>商品编码</th><th>商品名称</th><th>分类</th><th>单位</th><th>采购价</th><th>批发价</th><th>零售价</th><th>库存</th><th>库存状态</th><th>操作</th></tr></thead>
        <tbody id="productTableBody">${renderProductRows(db.products)}</tbody>
      </table></div>
    </div></div>
  `;
  document.getElementById('mainContent').innerHTML = html;
}

function renderProductRows(products) {
  if (products.length === 0) return '<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">📦</div><p>暂无商品数据</p></div></td></tr>';
  return products.map(p => `
    <tr>
      <td><strong>${p.code}</strong></td><td>${p.name}</td><td>${p.category}</td><td>${p.unit}</td>
      <td class="amount">${formatMoney(pp(p))}</td><td class="amount">${formatMoney(wp(p))}</td><td class="amount">${formatMoney(sp(p))}</td>
      <td><strong>${p.stock}</strong></td>
      <td>${p.stock < ms(p) ? '<span class="stock-low">⚠ 库存不足</span>' : '<span class="stock-normal">✅ 正常</span>'}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-outline" onclick="showEditProductModal('${p.id}')">编辑</button>
          <button class="btn btn-sm btn-text" style="color:var(--danger)" onclick="deleteProduct('${p.id}')">删除</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterProducts() {
  const db = getDB();
  const search = (document.getElementById('productSearch')?.value || '').toLowerCase();
  const cat = document.getElementById('productCatFilter')?.value || '';
  const stock = document.getElementById('productStockFilter')?.value || '';
  let filtered = db.products;
  if (search) filtered = filtered.filter(p => p.name.toLowerCase().includes(search) || p.code.toLowerCase().includes(search));
  if (cat) filtered = filtered.filter(p => p.category === cat);
  if (stock === 'low') filtered = filtered.filter(p => p.stock < ms(p));
  if (stock === 'normal') filtered = filtered.filter(p => p.stock >= ms(p));
  const tbody = document.getElementById('productTableBody');
  if (tbody) tbody.innerHTML = renderProductRows(filtered);
}

function showAddProductModal() {
  const db = getDB();
  const categories = [...new Set(db.products.map(p => p.category))];
  showModal('新增商品', `
    <div class="form-row">
      <div class="form-group"><label>商品编码 <span style="color:var(--danger)">*</span></label><input type="text" class="form-input" id="prodCode" value="GD-${String(db.products.length + 1).padStart(3, '0')}" required></div>
      <div class="form-group"><label>商品名称 <span style="color:var(--danger)">*</span></label><input type="text" class="form-input" id="prodName" required></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>分类</label><input type="text" class="form-input" id="prodCategory" list="catList" value="${categories[0] || ''}"><datalist id="catList">${categories.map(c => `<option value="${c}">`).join('')}</datalist></div>
      <div class="form-group"><label>单位</label><select class="form-select" id="prodUnit">${['个','套','台','只','卷','片','箱','包','盒','件','袋'].map(u => `<option value="${u}">${u}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>采购价 (元) <span style="color:var(--danger)">*</span></label><input type="number" class="form-input" id="prodPurchasePrice" step="0.01" min="0" required></div>
      <div class="form-group"><label>批发价 (元)</label><input type="number" class="form-input" id="prodWholesalePrice" step="0.01" min="0" placeholder="批发客户成交价"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>零售价 (元) <span style="color:var(--danger)">*</span></label><input type="number" class="form-input" id="prodSalePrice" step="0.01" min="0" required></div>
      <div class="form-group"><label>初始库存</label><input type="number" class="form-input" id="prodStock" min="0" value="0"></div>
    </div>
    <div class="form-group"><label>安全库存</label><input type="number" class="form-input" id="prodMinStock" min="0" value="10"></div>
  `, `<button class="btn btn-text" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveProduct()">保存</button>`);
}

function showEditProductModal(productId) {
  const db = getDB();
  const p = db.products.find(x => x.id === productId);
  if (!p) return;
  const categories = [...new Set(db.products.map(x => x.category))];
  showModal('编辑商品', `
    <input type="hidden" id="editProductId" value="${p.id}">
    <div class="form-row">
      <div class="form-group"><label>商品编码</label><input type="text" class="form-input" id="prodCode" value="${p.code}" required></div>
      <div class="form-group"><label>商品名称 <span style="color:var(--danger)">*</span></label><input type="text" class="form-input" id="prodName" value="${p.name}" required></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>分类</label><input type="text" class="form-input" id="prodCategory" list="catList" value="${p.category}"><datalist id="catList">${categories.map(c => `<option value="${c}">`).join('')}</datalist></div>
      <div class="form-group"><label>单位</label><select class="form-select" id="prodUnit">${['个','套','台','只','卷','片','箱','包','盒','件','袋'].map(u => `<option value="${u}" ${p.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>采购价 (元)</label><input type="number" class="form-input" id="prodPurchasePrice" step="0.01" min="0" value="${pp(p)}" required></div>
      <div class="form-group"><label>批发价 (元)</label><input type="number" class="form-input" id="prodWholesalePrice" step="0.01" min="0" value="${wp(p)}" placeholder="批发客户成交价"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>零售价 (元)</label><input type="number" class="form-input" id="prodSalePrice" step="0.01" min="0" value="${sp(p)}" required></div>
      <div class="form-group"><label>当前库存</label><input type="number" class="form-input" id="prodStock" min="0" value="${p.stock}"></div>
    </div>
    <div class="form-group"><label>安全库存</label><input type="number" class="form-input" id="prodMinStock" min="0" value="${ms(p)}"></div>
  `, `<button class="btn btn-text" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveProduct(true)">保存修改</button>`);
}

async function saveProduct(isEdit = false) {
  const code = document.getElementById('prodCode').value.trim();
  const name = document.getElementById('prodName').value.trim();
  const category = document.getElementById('prodCategory').value.trim();
  const unit = document.getElementById('prodUnit').value;
  const purchasePrice = parseFloat(document.getElementById('prodPurchasePrice').value);
  const salePrice = parseFloat(document.getElementById('prodSalePrice').value);
  const wholesalePrice = parseFloat(document.getElementById('prodWholesalePrice').value) || 0;
  const stock = parseInt(document.getElementById('prodStock').value) || 0;
  const minStock = parseInt(document.getElementById('prodMinStock').value) || 0;

  if (!code || !name || isNaN(purchasePrice) || isNaN(salePrice)) { showToast('请填写完整信息', 'error'); return; }
  if (wholesalePrice > salePrice) { showToast('批发价不能高于零售价', 'error'); return; }

  try {
    const body = { code, name, category: category || '未分类', unit, purchasePrice, salePrice, wholesalePrice, stock, minStock };
    if (isEdit) body.id = document.getElementById('editProductId').value;
    await api('/products', { method: 'POST', body });
    _cache.products = await api('/products');
    closeModal();
    renderProducts();
    showToast(isEdit ? '商品已更新' : '商品已添加', 'success');
  } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function deleteProduct(id) {
  const db = getDB();
  const p = db.products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`确定删除商品「${p.name}」吗？`)) return;
  try {
    await api(`/products/${id}`, { method: 'DELETE' });
    _cache.products = await api('/products');
    renderProducts();
    showToast('商品已删除', 'success');
  } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

// ==================== 供应商管理 ====================
function renderSuppliers() {
  const db = getDB();
  document.getElementById('mainContent').innerHTML = `
    <div class="page-header"><h2>🏭 供应商管理</h2><div class="page-header-actions"><button class="btn btn-primary" onclick="showAddSupplierModal()">+ 新增供应商</button></div></div>
    <div class="card"><div class="card-body">
      <div class="search-bar"><div class="search-input-wrapper"><span class="search-icon">🔍</span><input type="text" class="form-input" id="supplierSearch" placeholder="搜索供应商..." oninput="filterSuppliers()"></div></div>
      <div class="table-container"><table>
        <thead><tr><th>编码</th><th>供应商名称</th><th>联系人</th><th>电话</th><th>地址</th><th>操作</th></tr></thead>
        <tbody id="supplierTableBody">
          ${db.suppliers.map(s => `<tr><td><strong>${s.code}</strong></td><td>${s.name}</td><td>${s.contact}</td><td>${s.phone}</td><td>${s.address}</td><td><div class="table-actions"><button class="btn btn-sm btn-outline" onclick="showSupplierModal('${s.id}')">编辑</button><button class="btn btn-sm btn-text" style="color:var(--danger)" onclick="deleteSupplier('${s.id}')">删除</button></div></td></tr>`).join('')}
          ${db.suppliers.length === 0 ? '<tr><td colspan="6"><div class="empty-state"><p>暂无供应商</p></div></td></tr>' : ''}
        </tbody>
      </table></div>
    </div></div>
  `;
}

function filterSuppliers() {
  const db = getDB();
  const q = (document.getElementById('supplierSearch')?.value || '').toLowerCase();
  const filtered = q ? db.suppliers.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) : db.suppliers;
  const tbody = document.getElementById('supplierTableBody');
  if (tbody) tbody.innerHTML = filtered.map(s => `<tr><td><strong>${s.code}</strong></td><td>${s.name}</td><td>${s.contact}</td><td>${s.phone}</td><td>${s.address}</td><td><div class="table-actions"><button class="btn btn-sm btn-outline" onclick="showSupplierModal('${s.id}')">编辑</button><button class="btn btn-sm btn-text" style="color:var(--danger)" onclick="deleteSupplier('${s.id}')">删除</button></div></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty-state"><p>未找到匹配的供应商</p></div></td></tr>';
}

function showAddSupplierModal() { showSupplierModal(null); }

function showSupplierModal(id) {
  const db = getDB();
  const s = id ? db.suppliers.find(x => x.id === id) : null;
  const isEdit = !!s;
  showModal(isEdit ? '编辑供应商' : '新增供应商', `
    ${isEdit ? `<input type="hidden" id="editSupplierId" value="${s.id}">` : ''}
    <div class="form-row">
      <div class="form-group"><label>供应商编码</label><input type="text" class="form-input" id="suppCode" value="${s ? s.code : 'GYS-' + String(db.suppliers.length+1).padStart(3,'0')}" required></div>
      <div class="form-group"><label>供应商名称 <span style="color:var(--danger)">*</span></label><input type="text" class="form-input" id="suppName" value="${s ? s.name : ''}" required></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>联系人</label><input type="text" class="form-input" id="suppContact" value="${s ? s.contact : ''}"></div>
      <div class="form-group"><label>联系电话</label><input type="text" class="form-input" id="suppPhone" value="${s ? s.phone : ''}"></div>
    </div>
    <div class="form-group"><label>地址</label><input type="text" class="form-input" id="suppAddress" value="${s ? s.address : ''}"></div>
  `, `<button class="btn btn-text" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveSupplier(${isEdit})">保存</button>`);
}

async function saveSupplier(isEdit) {
  const code = document.getElementById('suppCode').value.trim();
  const name = document.getElementById('suppName').value.trim();
  if (!name) { showToast('请输入供应商名称', 'error'); return; }
  const body = { code, name, contact: document.getElementById('suppContact').value.trim(), phone: document.getElementById('suppPhone').value.trim(), address: document.getElementById('suppAddress').value.trim() };
  if (isEdit) body.id = document.getElementById('editSupplierId').value;
  try {
    await api('/suppliers', { method: 'POST', body });
    _cache.suppliers = await api('/suppliers');
    closeModal();
    renderSuppliers();
    showToast(isEdit ? '供应商已更新' : '供应商已添加', 'success');
  } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function deleteSupplier(id) {
  const db = getDB();
  const s = db.suppliers.find(x => x.id === id);
  if (!s) return;
  if (!confirm(`确定删除供应商「${s.name}」吗？`)) return;
  try {
    await api(`/suppliers/${id}`, { method: 'DELETE' });
    _cache.suppliers = await api('/suppliers');
    renderSuppliers();
    showToast('供应商已删除', 'success');
  } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

// ==================== 客户管理 ====================
function renderCustomers() {
  const db = getDB();
  document.getElementById('mainContent').innerHTML = `
    <div class="page-header"><h2>👥 客户管理</h2><div class="page-header-actions"><button class="btn btn-primary" onclick="showAddCustomerModal()">+ 新增客户</button></div></div>
    <div class="card"><div class="card-body">
      <div class="search-bar"><div class="search-input-wrapper"><span class="search-icon">🔍</span><input type="text" class="form-input" id="customerSearch" placeholder="搜索客户..." oninput="filterCustomers()"></div></div>
      <div class="table-container"><table>
        <thead><tr><th>编码</th><th>客户名称</th><th>类型</th><th>联系人</th><th>电话</th><th>地址</th><th>操作</th></tr></thead>
        <tbody id="customerTableBody">
          ${db.customers.map(c => `<tr><td><strong>${c.code}</strong></td><td>${c.name}</td><td>${ctypeLabel(c)}</td><td>${c.contact}</td><td>${c.phone}</td><td>${c.address}</td><td><div class="table-actions"><button class="btn btn-sm btn-outline" onclick="showCustomerModal('${c.id}')">编辑</button><button class="btn btn-sm btn-text" style="color:var(--danger)" onclick="deleteCustomer('${c.id}')">删除</button></div></td></tr>`).join('')}
          ${db.customers.length === 0 ? '<tr><td colspan="7"><div class="empty-state"><p>暂无客户</p></div></td></tr>' : ''}
        </tbody>
      </table></div>
    </div></div>
  `;
}

function filterCustomers() {
  const db = getDB();
  const q = (document.getElementById('customerSearch')?.value || '').toLowerCase();
  const filtered = q ? db.customers.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) : db.customers;
  const tbody = document.getElementById('customerTableBody');
  if (tbody) tbody.innerHTML = filtered.map(c => `<tr><td><strong>${c.code}</strong></td><td>${c.name}</td><td>${ctypeLabel(c)}</td><td>${c.contact}</td><td>${c.phone}</td><td>${c.address}</td><td><div class="table-actions"><button class="btn btn-sm btn-outline" onclick="showCustomerModal('${c.id}')">编辑</button><button class="btn btn-sm btn-text" style="color:var(--danger)" onclick="deleteCustomer('${c.id}')">删除</button></div></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty-state"><p>未找到匹配的客户</p></div></td></tr>';
}

function showAddCustomerModal() { showCustomerModal(null); }

function showCustomerModal(id) {
  const db = getDB();
  const c = id ? db.customers.find(x => x.id === id) : null;
  const isEdit = !!c;
  showModal(isEdit ? '编辑客户' : '新增客户', `
    ${isEdit ? `<input type="hidden" id="editCustomerId" value="${c.id}">` : ''}
    <div class="form-row">
      <div class="form-group"><label>客户编码</label><input type="text" class="form-input" id="custCode" value="${c ? c.code : 'KH-' + String(db.customers.length+1).padStart(3,'0')}"></div>
      <div class="form-group"><label>客户名称 <span style="color:var(--danger)">*</span></label><input type="text" class="form-input" id="custName" value="${c ? c.name : ''}" required></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>联系人</label><input type="text" class="form-input" id="custContact" value="${c ? c.contact : ''}"></div>
      <div class="form-group"><label>电话</label><input type="text" class="form-input" id="custPhone" value="${c ? c.phone : ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>客户类型 <span style="color:var(--danger)">*</span></label>
        <select class="form-select" id="custType">
          <option value="wholesale" ${c && ctype(c) === 'wholesale' ? 'selected' : ''}>批发客户（乡镇灯具店等，按批发价）</option>
          <option value="retail" ${!c || ctype(c) === 'retail' ? 'selected' : ''}>零售客户（散客，按零售价）</option>
        </select>
      </div>
      <div class="form-group"><label>地址</label><input type="text" class="form-input" id="custAddress" value="${c ? c.address : ''}"></div>
    </div>
  `, `<button class="btn btn-text" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveCustomer(${isEdit})">保存</button>`);
}

async function saveCustomer(isEdit) {
  const code = document.getElementById('custCode').value.trim();
  const name = document.getElementById('custName').value.trim();
  if (!name) { showToast('请输入客户名称', 'error'); return; }
  const body = { code, name, type: document.getElementById('custType').value, contact: document.getElementById('custContact').value.trim(), phone: document.getElementById('custPhone').value.trim(), address: document.getElementById('custAddress').value.trim() };
  if (isEdit) body.id = document.getElementById('editCustomerId').value;
  try {
    await api('/customers', { method: 'POST', body });
    _cache.customers = await api('/customers');
    closeModal();
    renderCustomers();
    showToast(isEdit ? '客户已更新' : '客户已添加', 'success');
  } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function deleteCustomer(id) {
  const db = getDB();
  const c = db.customers.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`确定删除客户「${c.name}」吗？`)) return;
  try {
    await api(`/customers/${id}`, { method: 'DELETE' });
    _cache.customers = await api('/customers');
    renderCustomers();
    showToast('客户已删除', 'success');
  } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

// ==================== 采购管理 ====================
function renderPurchaseOrders() {
  const db = getDB();
  document.getElementById('mainContent').innerHTML = `
    <div class="page-header"><h2>📥 采购管理</h2><div class="page-header-actions"><button class="btn btn-primary" onclick="showAddPurchaseOrderModal()">+ 新建采购单</button></div></div>
    <div class="tabs">
      <div class="tab-item active" onclick="filterPurchaseOrders('all', this)">全部</div>
      <div class="tab-item" onclick="filterPurchaseOrders('draft', this)">草稿</div>
      <div class="tab-item" onclick="filterPurchaseOrders('confirmed', this)">已确认</div>
      <div class="tab-item" onclick="filterPurchaseOrders('received', this)">已入库</div>
    </div>
    <div class="card"><div class="card-body" style="padding:0;"><div class="table-container"><table>
      <thead><tr><th>订单编号</th><th>供应商</th><th>商品数</th><th>总金额</th><th>状态</th><th>制单人</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody id="purchaseTableBody">${renderPurchaseRows(db.purchaseOrders, db)}</tbody>
    </table></div></div></div>
  `;
}

function renderPurchaseRows(orders, db) {
  if (orders.length === 0) return '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📥</div><p>暂无采购订单</p></div></td></tr>';
  return orders.sort((a,b) => (typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : b.createdAt) - (typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : a.createdAt)).map(o => {
    const supplier = db.suppliers.find(s => s.id === o.supplierId);
    const createdBy = db.users.find(u => u.id === o.createdBy);
    return `<tr>
      <td><strong>${o.orderNo}</strong></td><td>${supplier ? supplier.name : '-'}</td><td>${o.items.length} 种</td>
      <td class="amount">${formatMoney(o.totalAmount)}</td><td><span class="status-tag ${o.status}">${statusLabel(o.status)}</span></td>
      <td>${createdBy ? createdBy.name : '-'}</td><td>${formatDate(typeof o.createdAt === 'string' ? new Date(o.createdAt).getTime() : o.createdAt)}</td>
      <td><div class="table-actions">
        <button class="btn btn-sm btn-outline" onclick="viewPurchaseOrder('${o.id}')">详情</button>
        ${o.status === 'draft' ? `<button class="btn btn-sm btn-primary" onclick="changeOrderStatus('${o.id}', 'purchase', 'confirmed')">确认</button>` : ''}
        ${o.status === 'confirmed' ? `<button class="btn btn-sm btn-success" onclick="changeOrderStatus('${o.id}', 'purchase', 'received')">入库</button>` : ''}
        ${o.status === 'draft' ? `<button class="btn btn-sm btn-text" style="color:var(--danger)" onclick="deletePurchaseOrder('${o.id}')">删除</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

function filterPurchaseOrders(status, tabEl) {
  const db = getDB();
  document.querySelectorAll('#mainContent .tab-item').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  const filtered = status === 'all' ? db.purchaseOrders : db.purchaseOrders.filter(o => o.status === status);
  const tbody = document.getElementById('purchaseTableBody');
  if (tbody) tbody.innerHTML = renderPurchaseRows(filtered, db);
}

function showAddPurchaseOrderModal() {
  const db = getDB();
  showModal('新建采购订单', `
    <div class="form-group"><label>供应商 <span style="color:var(--danger)">*</span></label>
      <select class="form-select" id="poSupplier"><option value="">-- 请选择供应商 --</option>${db.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
    <div class="form-group"><label>添加商品</label>
      <div style="display:flex;gap:8px;">
        <select class="form-select" id="poProduct" style="flex:1">${db.products.map(p => `<option value="${p.id}" data-price="${pp(p)}" data-name="${p.name}" data-unit="${p.unit}">${p.name} (${p.code}) - ¥${pp(p)}/${p.unit}</option>`).join('')}</select>
        <input type="number" class="form-input" id="poQuantity" placeholder="数量" min="1" value="1" style="width:80px;">
        <button class="btn btn-outline" onclick="addPOItem()">+ 添加</button>
      </div></div>
    <div class="table-container" style="margin-top:12px;"><table><thead><tr><th>商品</th><th>单价</th><th>数量</th><th>小计</th><th>操作</th></tr></thead><tbody id="poItemsTable"><tr><td colspan="5" style="text-align:center;color:var(--gray-400)">请添加商品</td></tr></tbody></table></div>
    <div style="text-align:right;margin-top:12px;font-size:16px;">合计：<strong id="poTotal" style="color:var(--primary)">¥0.00</strong></div>
    <div class="form-group" style="margin-top:12px;"><label>备注</label><textarea class="form-textarea" id="poNote" placeholder="选填"></textarea></div>
  `, `<button class="btn btn-text" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="savePurchaseOrder()">保存为草稿</button>`);
  window._poItems = [];
}

function addPOItem() {
  const select = document.getElementById('poProduct');
  const qty = parseInt(document.getElementById('poQuantity').value) || 1;
  if (!select.value) return;
  const option = select.options[select.selectedIndex];
  const name = option.dataset.name;
  const price = parseFloat(option.dataset.price);
  const productId = option.value;
  window._poItems = window._poItems || [];
  const existing = window._poItems.find(i => i.productId === productId);
  if (existing) { existing.quantity += qty; existing.total = existing.quantity * existing.unitPrice; }
  else { window._poItems.push({ productId, productName: name, quantity: qty, unitPrice: price, total: price * qty }); }
  updatePOItemsTable();
}

function updatePOItemsTable() {
  const items = window._poItems || [];
  const tbody = document.getElementById('poItemsTable');
  if (!tbody) return;
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--gray-400)">请添加商品</td></tr>'; }
  else { tbody.innerHTML = items.map((item, i) => `<tr><td>${item.productName}</td><td>${formatMoney(item.unitPrice)}</td><td><input type="number" value="${item.quantity}" min="1" style="width:60px;padding:4px 8px;border:1px solid var(--gray-300);border-radius:4px;" onchange="updatePOItemQty(${i}, this.value)"></td><td class="amount">${formatMoney(item.total)}</td><td><button class="btn btn-sm btn-text" style="color:var(--danger)" onclick="removePOItem(${i})">删除</button></td></tr>`).join(''); }
  const total = items.reduce((s, i) => s + i.total, 0);
  const totalEl = document.getElementById('poTotal');
  if (totalEl) totalEl.textContent = formatMoney(total);
}

function updatePOItemQty(idx, qty) { qty = parseInt(qty) || 1; window._poItems[idx].quantity = qty; window._poItems[idx].total = qty * window._poItems[idx].unitPrice; updatePOItemsTable(); }
function removePOItem(idx) { window._poItems.splice(idx, 1); updatePOItemsTable(); }

async function savePurchaseOrder() {
  const db = getDB();
  const supplierId = document.getElementById('poSupplier').value;
  const note = document.getElementById('poNote').value.trim();
  if (!supplierId) { showToast('请选择供应商', 'error'); return; }
  if (!window._poItems || window._poItems.length === 0) { showToast('请添加至少一个商品', 'error'); return; }
  const orderNo = getNextOrderNo('CG', db.purchaseOrders);
  const totalAmount = window._poItems.reduce((s, i) => s + i.total, 0);
  try {
    await api('/purchase-orders', { method: 'POST', body: { orderNo, supplierId, items: window._poItems, totalAmount, status: 'draft', note, createdBy: currentUser.id } });
    _cache.purchaseOrders = await api('/purchase-orders');
    window._poItems = [];
    closeModal();
    renderPurchaseOrders();
    showToast('采购订单已保存为草稿', 'success');
  } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
}

function viewPurchaseOrder(id) {
  const db = getDB();
  const order = db.purchaseOrders.find(o => o.id === id);
  if (!order) return;
  const supplier = db.suppliers.find(s => s.id === order.supplierId);
  const creator = db.users.find(u => u.id === order.createdBy);
  const ct = typeof order.createdAt === 'string' ? new Date(order.createdAt).getTime() : order.createdAt;
  const ut = typeof order.updatedAt === 'string' ? new Date(order.updatedAt).getTime() : order.updatedAt;
  showModal(`采购订单 ${order.orderNo}`, `
    <div class="order-detail-grid">
      <div class="order-detail-item"><label>订单编号</label><span>${order.orderNo}</span></div>
      <div class="order-detail-item"><label>供应商</label><span>${supplier ? supplier.name : '-'}</span></div>
      <div class="order-detail-item"><label>状态</label><span><span class="status-tag ${order.status}">${statusLabel(order.status)}</span></span></div>
      <div class="order-detail-item"><label>制单人</label><span>${creator ? creator.name : '-'}</span></div>
      <div class="order-detail-item"><label>创建时间</label><span>${formatDate(ct)}</span></div>
      <div class="order-detail-item"><label>更新时间</label><span>${formatDate(ut)}</span></div>
    </div>
    ${order.note ? `<p style="margin-bottom:12px;color:var(--gray-500);"><strong>备注：</strong>${order.note}</p>` : ''}
    <div class="table-container"><table><thead><tr><th>商品</th><th>单价</th><th>数量</th><th>小计</th></tr></thead><tbody>
      ${order.items.map(item => `<tr><td>${item.productName}</td><td>${formatMoney(item.unitPrice)}</td><td>${item.quantity}</td><td class="amount">${formatMoney(item.total)}</td></tr>`).join('')}
      <tr style="background:var(--gray-50);font-weight:700;"><td colspan="3" style="text-align:right;">合计</td><td class="amount" style="color:var(--primary)">${formatMoney(order.totalAmount)}</td></tr>
    </tbody></table></div>
  `, `<button class="btn btn-outline" onclick="closeModal()">关闭</button>`);
}

async function changeOrderStatus(id, type, newStatus) {
  const db = getDB();
  const arr = type === 'purchase' ? db.purchaseOrders : db.salesOrders;
  const order = arr.find(o => o.id === id);
  if (!order) return;
  const labels = { draft: '草稿', confirmed: '已确认', received: '已入库', shipped: '已发货', completed: '已完成', cancelled: '已取消' };
  if (!confirm(`确定将订单 ${order.orderNo} 状态从「${labels[order.status]}」变更为「${labels[newStatus]}」吗？`)) return;

  try {
    if (type === 'purchase' && newStatus === 'received') {
      await api(`/purchase-orders/${id}/receive`, { method: 'POST', body: { operator: currentUser.id } });
    } else if (type === 'sales' && newStatus === 'shipped') {
      await api(`/sales-orders/${id}/ship`, { method: 'POST', body: { operator: currentUser.id } });
    } else {
      // 简单状态变更
      const body = { ...order, status: newStatus };
      await api(`/${type === 'purchase' ? 'purchase-orders' : 'sales-orders'}`, { method: 'POST', body });
    }
    _cache.purchaseOrders = await api('/purchase-orders');
    _cache.salesOrders = await api('/sales-orders');
    _cache.products = await api('/products');
    _cache.inventoryLogs = await api('/inventory-logs');
    if (type === 'purchase') renderPurchaseOrders(); else renderSalesOrders();
    showToast(`订单状态已更新为「${labels[newStatus]}」`, 'success');
  } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function deletePurchaseOrder(id) {
  const db = getDB();
  const order = db.purchaseOrders.find(o => o.id === id);
  if (!order) return;
  if (order.status !== 'draft') { showToast('只能删除草稿状态的订单', 'error'); return; }
  if (!confirm('确定删除该采购订单吗？')) return;
  try {
    await api(`/purchase-orders/${id}`, { method: 'DELETE' });
    _cache.purchaseOrders = await api('/purchase-orders');
    renderPurchaseOrders();
    showToast('订单已删除', 'success');
  } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

// ==================== 销售管理 ====================
function renderSalesOrders() {
  const db = getDB();
  document.getElementById('mainContent').innerHTML = `
    <div class="page-header"><h2>📤 销售管理</h2><div class="page-header-actions"><button class="btn btn-primary" onclick="showAddSalesOrderModal()">+ 新建销售单</button></div></div>
    <div class="tabs">
      <div class="tab-item active" onclick="filterSalesOrders('all', this)">全部</div>
      <div class="tab-item" onclick="filterSalesOrders('draft', this)">草稿</div>
      <div class="tab-item" onclick="filterSalesOrders('confirmed', this)">已确认</div>
      <div class="tab-item" onclick="filterSalesOrders('shipped', this)">已发货</div>
      <div class="tab-item" onclick="filterSalesOrders('completed', this)">已完成</div>
    </div>
    <div class="card"><div class="card-body" style="padding:0;"><div class="table-container"><table>
      <thead><tr><th>订单编号</th><th>客户</th><th>商品数</th><th>总金额</th><th>状态</th><th>制单人</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody id="salesTableBody">${renderSalesRows(db.salesOrders, db)}</tbody>
    </table></div></div></div>
  `;
}

function renderSalesRows(orders, db) {
  if (orders.length === 0) return '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📤</div><p>暂无销售订单</p></div></td></tr>';
  return orders.sort((a,b) => (typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : b.createdAt) - (typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : a.createdAt)).map(o => {
    const customer = db.customers.find(c => c.id === o.customerId);
    const createdBy = db.users.find(u => u.id === o.createdBy);
    return `<tr>
      <td><strong>${o.orderNo}</strong></td><td>${customer ? customer.name : '-'}</td><td>${o.items.length} 种</td>
      <td class="amount">${formatMoney(o.totalAmount)}</td><td><span class="status-tag ${o.status}">${statusLabel(o.status)}</span></td>
      <td>${createdBy ? createdBy.name : '-'}</td><td>${formatDate(typeof o.createdAt === 'string' ? new Date(o.createdAt).getTime() : o.createdAt)}</td>
      <td><div class="table-actions">
        <button class="btn btn-sm btn-outline" onclick="viewSalesOrder('${o.id}')">详情</button>
        ${o.status === 'draft' ? `<button class="btn btn-sm btn-primary" onclick="changeOrderStatus('${o.id}', 'sales', 'confirmed')">确认</button>` : ''}
        ${o.status === 'confirmed' ? `<button class="btn btn-sm btn-success" onclick="changeOrderStatus('${o.id}', 'sales', 'shipped')">发货</button>` : ''}
        ${o.status === 'shipped' ? `<button class="btn btn-sm btn-success" onclick="changeOrderStatus('${o.id}', 'sales', 'completed')">完成</button>` : ''}
        ${o.status === 'draft' ? `<button class="btn btn-sm btn-text" style="color:var(--danger)" onclick="deleteSalesOrder('${o.id}')">删除</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

function filterSalesOrders(status, tabEl) {
  const db = getDB();
  document.querySelectorAll('#mainContent .tab-item').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  const filtered = status === 'all' ? db.salesOrders : db.salesOrders.filter(o => o.status === status);
  const tbody = document.getElementById('salesTableBody');
  if (tbody) tbody.innerHTML = renderSalesRows(filtered, db);
}

function showAddSalesOrderModal() {
  const db = getDB();
  showModal('新建销售订单', `
    <div class="form-group"><label>客户 <span style="color:var(--danger)">*</span></label>
      <select class="form-select" id="soCustomer" onchange="onSOCustomerChange()"><option value="">-- 请选择客户 --</option>${db.customers.map(c => `<option value="${c.id}">${c.name}${ctype(c) === 'wholesale' ? '（批发）' : '（零售）'}</option>`).join('')}</select>
      <div id="soPriceModeHint" style="margin-top:6px;font-size:12px;color:var(--gray-400);">💡 选择客户后，商品将按其类型自动带出批发价或零售价，单价可手动修改</div>
    </div>
    <div class="form-group"><label>添加商品</label>
      <div style="display:flex;gap:8px;">
        <select class="form-select" id="soProduct" style="flex:1">${db.products.map(p => {
          const disabled = p.stock <= 0 ? 'disabled' : '';
          const priceVal = soPriceFor(p);
          return `<option value="${p.id}" data-price="${priceVal}" data-name="${p.name}" data-unit="${p.unit}" ${disabled}>${p.name} (${p.code}) - ¥${priceVal}/${p.unit} [库存:${p.stock}]${p.stock <= 0 ? ' - 缺货' : ''}</option>`;
        }).join('')}</select>
        <input type="number" class="form-input" id="soQuantity" placeholder="数量" min="1" value="1" style="width:80px;">
        <button class="btn btn-outline" onclick="addSOItem()">+ 添加</button>
      </div></div>
    <div class="table-container" style="margin-top:12px;"><table><thead><tr><th>商品</th><th>单价</th><th>数量</th><th>小计</th><th>操作</th></tr></thead><tbody id="soItemsTable"><tr><td colspan="5" style="text-align:center;color:var(--gray-400)">请添加商品</td></tr></tbody></table></div>
    <div style="text-align:right;margin-top:12px;font-size:16px;">合计：<strong id="soTotal" style="color:var(--primary)">¥0.00</strong></div>
    <div class="form-group" style="margin-top:12px;"><label>备注</label><textarea class="form-textarea" id="soNote" placeholder="选填"></textarea></div>
  `, `<button class="btn btn-text" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveSalesOrder()">保存为草稿</button>`);
  window._soItems = [];
  refreshSOProductOptions();
}

// 当前销售单应使用的价格：批发客户用批发价(无批发价则退回零售价)，零售客户用零售价
function soPriceFor(p) {
  const customer = getSelectedSOCustomer();
  if (customer && ctype(customer) === 'wholesale') {
    const w = wp(p);
    return w > 0 ? w : sp(p);
  }
  return sp(p);
}

function getSelectedSOCustomer() {
  const sel = document.getElementById('soCustomer');
  if (!sel || !sel.value) return null;
  return getDB().customers.find(c => c.id === sel.value) || null;
}

function refreshSOProductOptions() {
  const select = document.getElementById('soProduct');
  if (!select) return;
  const prev = select.value;
  const db = getDB();
  select.innerHTML = db.products.map(p => {
    const disabled = p.stock <= 0 ? 'disabled' : '';
    const priceVal = soPriceFor(p);
    return `<option value="${p.id}" data-price="${priceVal}" data-name="${p.name}" data-unit="${p.unit}" ${disabled}>${p.name} (${p.code}) - ¥${priceVal}/${p.unit} [库存:${p.stock}]${p.stock <= 0 ? ' - 缺货' : ''}</option>`;
  }).join('');
  if (prev && db.products.some(p => p.id === prev)) select.value = prev;
  // 更新价格模式提示
  const hint = document.getElementById('soPriceModeHint');
  const customer = getSelectedSOCustomer();
  if (hint && customer) {
    hint.innerHTML = ctype(customer) === 'wholesale'
      ? '🏷️ <strong style="color:#e65100">批发客户</strong> — 商品按<b>批发价</b>带出，单价可手动修改'
      : '🛒 <strong style="color:#1565c0">零售客户</strong> — 商品按<b>零售价</b>带出，单价可手动修改';
  }
}

function onSOCustomerChange() {
  refreshSOProductOptions();
  // 重新按新客户类型计价购物车中已有商品
  const db = getDB();
  (window._soItems || []).forEach(item => {
    const p = db.products.find(x => x.id === item.productId);
    if (p) { item.unitPrice = soPriceFor(p); item.total = item.unitPrice * item.quantity; }
  });
  updateSOItemsTable();
}

function addSOItem() {
  const db = getDB();
  const select = document.getElementById('soProduct');
  const qty = parseInt(document.getElementById('soQuantity').value) || 1;
  if (!select.value) return;
  const option = select.options[select.selectedIndex];
  const name = option.dataset.name;
  const price = parseFloat(option.dataset.price);
  const productId = option.value;
  const product = db.products.find(p => p.id === productId);
  if (product) {
    const currentInCart = (window._soItems || []).find(i => i.productId === productId);
    const totalQty = (currentInCart ? currentInCart.quantity : 0) + qty;
    if (totalQty > product.stock) { showToast(`库存不足！当前库存: ${product.stock}`, 'error'); return; }
  }
  window._soItems = window._soItems || [];
  const existing = window._soItems.find(i => i.productId === productId);
  if (existing) { existing.quantity += qty; existing.total = existing.quantity * existing.unitPrice; }
  else { window._soItems.push({ productId, productName: name, quantity: qty, unitPrice: price, total: price * qty }); }
  updateSOItemsTable();
}

function updateSOItemsTable() {
  const items = window._soItems || [];
  const tbody = document.getElementById('soItemsTable');
  if (!tbody) return;
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--gray-400)">请添加商品</td></tr>'; }
  else { tbody.innerHTML = items.map((item, i) => `<tr><td>${item.productName}</td><td><input type="number" value="${item.unitPrice}" min="0" step="0.01" style="width:80px;padding:4px 8px;border:1px solid var(--gray-300);border-radius:4px;" onchange="updateSOItemPrice(${i}, this.value)"></td><td><input type="number" value="${item.quantity}" min="1" style="width:60px;padding:4px 8px;border:1px solid var(--gray-300);border-radius:4px;" onchange="updateSOItemQty(${i}, this.value)"></td><td class="amount">${formatMoney(item.total)}</td><td><button class="btn btn-sm btn-text" style="color:var(--danger)" onclick="removeSOItem(${i})">删除</button></td></tr>`).join(''); }
  const total = items.reduce((s, i) => s + i.total, 0);
  const totalEl = document.getElementById('soTotal');
  if (totalEl) totalEl.textContent = formatMoney(total);
}

function updateSOItemQty(idx, qty) { qty = parseInt(qty) || 1; window._soItems[idx].quantity = qty; window._soItems[idx].total = qty * window._soItems[idx].unitPrice; updateSOItemsTable(); }
function updateSOItemPrice(idx, price) { price = parseFloat(price) || 0; window._soItems[idx].unitPrice = price; window._soItems[idx].total = price * window._soItems[idx].quantity; updateSOItemsTable(); }
function removeSOItem(idx) { window._soItems.splice(idx, 1); updateSOItemsTable(); }

async function saveSalesOrder() {
  const db = getDB();
  const customerId = document.getElementById('soCustomer').value;
  const note = document.getElementById('soNote').value.trim();
  if (!customerId) { showToast('请选择客户', 'error'); return; }
  if (!window._soItems || window._soItems.length === 0) { showToast('请添加至少一个商品', 'error'); return; }
  const orderNo = getNextOrderNo('XS', db.salesOrders);
  const totalAmount = window._soItems.reduce((s, i) => s + i.total, 0);
  try {
    await api('/sales-orders', { method: 'POST', body: { orderNo, customerId, items: window._soItems, totalAmount, status: 'draft', note, createdBy: currentUser.id } });
    _cache.salesOrders = await api('/sales-orders');
    window._soItems = [];
    closeModal();
    renderSalesOrders();
    showToast('销售订单已保存为草稿', 'success');
  } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
}

function viewSalesOrder(id) {
  const db = getDB();
  const order = db.salesOrders.find(o => o.id === id);
  if (!order) return;
  const customer = db.customers.find(c => c.id === order.customerId);
  const creator = db.users.find(u => u.id === order.createdBy);
  const ct = typeof order.createdAt === 'string' ? new Date(order.createdAt).getTime() : order.createdAt;
  const ut = typeof order.updatedAt === 'string' ? new Date(order.updatedAt).getTime() : order.updatedAt;
  showModal(`销售订单 ${order.orderNo}`, `
    <div class="order-detail-grid">
      <div class="order-detail-item"><label>订单编号</label><span>${order.orderNo}</span></div>
      <div class="order-detail-item"><label>客户</label><span>${customer ? customer.name : '-'}</span></div>
      <div class="order-detail-item"><label>状态</label><span><span class="status-tag ${order.status}">${statusLabel(order.status)}</span></span></div>
      <div class="order-detail-item"><label>制单人</label><span>${creator ? creator.name : '-'}</span></div>
      <div class="order-detail-item"><label>创建时间</label><span>${formatDate(ct)}</span></div>
      <div class="order-detail-item"><label>更新时间</label><span>${formatDate(ut)}</span></div>
    </div>
    ${order.note ? `<p style="margin-bottom:12px;color:var(--gray-500);"><strong>备注：</strong>${order.note}</p>` : ''}
    <div class="table-container"><table><thead><tr><th>商品</th><th>单价</th><th>数量</th><th>小计</th></tr></thead><tbody>
      ${order.items.map(item => `<tr><td>${item.productName}</td><td>${formatMoney(item.unitPrice)}</td><td>${item.quantity}</td><td class="amount">${formatMoney(item.total)}</td></tr>`).join('')}
      <tr style="background:var(--gray-50);font-weight:700;"><td colspan="3" style="text-align:right;">合计</td><td class="amount" style="color:var(--primary)">${formatMoney(order.totalAmount)}</td></tr>
    </tbody></table></div>
  `, `<button class="btn btn-outline" onclick="closeModal()">关闭</button>`);
}

async function deleteSalesOrder(id) {
  const db = getDB();
  const order = db.salesOrders.find(o => o.id === id);
  if (!order) return;
  if (order.status !== 'draft') { showToast('只能删除草稿状态的订单', 'error'); return; }
  if (!confirm('确定删除该销售订单吗？')) return;
  try {
    await api(`/sales-orders/${id}`, { method: 'DELETE' });
    _cache.salesOrders = await api('/sales-orders');
    renderSalesOrders();
    showToast('订单已删除', 'success');
  } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

// ==================== 库存管理 ====================
function renderInventory() {
  const db = getDB();
  document.getElementById('mainContent').innerHTML = `
    <div class="page-header"><h2>🏗️ 库存管理</h2><div class="page-header-actions"><button class="btn btn-outline" onclick="adjustInventory()">📝 库存调整</button></div></div>
    <div class="stats-grid" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-card-header"><div class="stat-card-icon blue">📦</div><span class="stat-card-label">商品总数</span></div><div class="stat-card-value">${db.products.length}</div></div>
      <div class="stat-card"><div class="stat-card-header"><div class="stat-card-icon green">✅</div><span class="stat-card-label">库存总额</span></div><div class="stat-card-value" style="font-size:22px;">${formatMoney(db.products.reduce((s, p) => s + pp(p) * p.stock, 0))}</div></div>
      <div class="stat-card"><div class="stat-card-header"><div class="stat-card-icon red">⚠️</div><span class="stat-card-label">库存预警</span></div><div class="stat-card-value">${db.products.filter(p => p.stock < ms(p)).length}</div></div>
    </div>
    <div class="card"><div class="card-body">
      <div class="search-bar">
        <div class="search-input-wrapper"><span class="search-icon">🔍</span><input type="text" class="form-input" id="invSearch" placeholder="搜索商品..." oninput="filterInventory()"></div>
        <select class="form-select" id="invStatusFilter" onchange="filterInventory()"><option value="">全部状态</option><option value="low">库存预警</option><option value="normal">库存正常</option></select>
      </div>
      <div class="table-container"><table>
        <thead><tr><th>编码</th><th>商品名称</th><th>分类</th><th>单位</th><th>当前库存</th><th>安全库存</th><th>状态</th><th>库存价值</th><th>操作</th></tr></thead>
        <tbody id="invTableBody">
          ${db.products.map(p => `<tr><td><strong>${p.code}</strong></td><td>${p.name}</td><td>${p.category}</td><td>${p.unit}</td><td><strong>${p.stock}</strong></td><td>${ms(p)}</td><td>${p.stock < ms(p) ? '<span class="stock-low">⚠ 库存不足</span>' : '<span class="stock-normal">✅ 正常</span>'}</td><td class="amount">${formatMoney(pp(p) * p.stock)}</td><td><div class="table-actions"><button class="btn btn-sm btn-outline" onclick="adjustSingleProduct('${p.id}')">调整</button></div></td></tr>`).join('')}
        </tbody>
      </table></div>
    </div></div>
    <div class="card" style="margin-top:24px;"><div class="card-header"><h3>📋 库存流水记录</h3></div><div class="card-body" style="padding:0;"><div class="table-container"><table>
      <thead><tr><th>时间</th><th>商品</th><th>类型</th><th>数量</th><th>关联单据</th></tr></thead><tbody>
        ${db.inventoryLogs.sort((a,b) => (typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : b.createdAt) - (typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : a.createdAt)).slice(0, 20).map(log => {
          const product = db.products.find(p => p.id === log.productId);
          return `<tr><td>${formatDate(typeof log.createdAt === 'string' ? new Date(log.createdAt).getTime() : log.createdAt)}</td><td>${product ? product.name : '-'}</td><td>${log.type === 'in' ? '<span style="color:var(--success)">📥 入库</span>' : '<span style="color:var(--warning)">📤 出库</span>'}</td><td><strong>${log.quantity}</strong></td><td>${log.relatedOrder}</td></tr>`;
        }).join('')}
        ${db.inventoryLogs.length === 0 ? '<tr><td colspan="5"><div class="empty-state"><p>暂无库存流水</p></div></td></tr>' : ''}
      </tbody>
    </table></div></div></div>
  `;
}

function filterInventory() {
  const db = getDB();
  const q = (document.getElementById('invSearch')?.value || '').toLowerCase();
  const status = document.getElementById('invStatusFilter')?.value || '';
  let filtered = db.products;
  if (q) filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  if (status === 'low') filtered = filtered.filter(p => p.stock < ms(p));
  if (status === 'normal') filtered = filtered.filter(p => p.stock >= ms(p));
  const tbody = document.getElementById('invTableBody');
  if (tbody) tbody.innerHTML = filtered.map(p => `<tr><td><strong>${p.code}</strong></td><td>${p.name}</td><td>${p.category}</td><td>${p.unit}</td><td><strong>${p.stock}</strong></td><td>${ms(p)}</td><td>${p.stock < ms(p) ? '<span class="stock-low">⚠ 库存不足</span>' : '<span class="stock-normal">✅ 正常</span>'}</td><td class="amount">${formatMoney(pp(p) * p.stock)}</td><td><div class="table-actions"><button class="btn btn-sm btn-outline" onclick="adjustSingleProduct('${p.id}')">调整</button></div></td></tr>`).join('');
}

function adjustInventory() {
  const db = getDB();
  showModal('库存调整', `
    <div class="form-group"><label>选择商品 <span style="color:var(--danger)">*</span></label><select class="form-select" id="adjBulkProduct">${db.products.map(p => `<option value="${p.id}">${p.name} (${p.code}) - 库存: ${p.stock}</option>`).join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>调整类型</label><select class="form-select" id="adjBulkType"><option value="in">📥 入库 (增加库存)</option><option value="out">📤 出库 (减少库存)</option></select></div>
      <div class="form-group"><label>数量</label><input type="number" class="form-input" id="adjBulkQty" min="1" value="1" required></div>
    </div>
    <div class="form-group"><label>备注</label><input type="text" class="form-input" id="adjBulkNote" placeholder="调整原因..."></div>
  `, `<button class="btn btn-text" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="submitBulkInventoryAdjust()">确认调整</button>`);
}

async function submitBulkInventoryAdjust() {
  const db = getDB();
  const pId = document.getElementById('adjBulkProduct').value;
  const type = document.getElementById('adjBulkType').value;
  const qty = parseInt(document.getElementById('adjBulkQty').value);
  const note = document.getElementById('adjBulkNote').value.trim();
  if (!pId) { showToast('请选择商品', 'error'); return; }
  if (isNaN(qty) || qty < 1) { showToast('请输入有效数量', 'error'); return; }
  const product = db.products.find(p => p.id === pId);
  if (!product) return;
  if (type === 'out' && qty > product.stock) { showToast('出库数量不能超过当前库存', 'error'); return; }
  const quantity = type === 'in' ? qty : -qty;
  try {
    await api('/inventory/adjust', { method: 'POST', body: { productId: pId, quantity, reason: note || '手动调整', operator: currentUser.id } });
    _cache.products = await api('/products');
    _cache.inventoryLogs = await api('/inventory-logs');
    closeModal();
    renderInventory();
    showToast('库存调整成功', 'success');
  } catch (e) { showToast('调整失败: ' + e.message, 'error'); }
}

function adjustSingleProduct(productId) {
  const db = getDB();
  const p = db.products.find(x => x.id === productId);
  if (!p) return;
  showModal('库存调整', `
    <input type="hidden" id="adjProductId" value="${p.id}">
    <p style="margin-bottom:12px;">商品：<strong>${p.name}</strong> (${p.code}) — 当前库存：<strong>${p.stock}</strong> ${p.unit}</p>
    <div class="form-row">
      <div class="form-group"><label>调整类型</label><select class="form-select" id="adjType"><option value="in">📥 入库 (增加库存)</option><option value="out">📤 出库 (减少库存)</option></select></div>
      <div class="form-group"><label>数量</label><input type="number" class="form-input" id="adjQty" min="1" value="1" required></div>
    </div>
    <div class="form-group"><label>备注</label><input type="text" class="form-input" id="adjNote" placeholder="调整原因..."></div>
  `, `<button class="btn btn-text" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="submitInventoryAdjust()">确认调整</button>`);
}

async function submitInventoryAdjust() {
  const db = getDB();
  const pId = document.getElementById('adjProductId').value;
  const type = document.getElementById('adjType').value;
  const qty = parseInt(document.getElementById('adjQty').value);
  const note = document.getElementById('adjNote').value.trim();
  if (isNaN(qty) || qty < 1) { showToast('请输入有效数量', 'error'); return; }
  const product = db.products.find(p => p.id === pId);
  if (!product) return;
  if (type === 'out' && qty > product.stock) { showToast('出库数量不能超过当前库存', 'error'); return; }
  const quantity = type === 'in' ? qty : -qty;
  try {
    await api('/inventory/adjust', { method: 'POST', body: { productId: pId, quantity, reason: note || '手动调整', operator: currentUser.id } });
    _cache.products = await api('/products');
    _cache.inventoryLogs = await api('/inventory-logs');
    closeModal();
    renderInventory();
    showToast('库存调整成功', 'success');
  } catch (e) { showToast('调整失败: ' + e.message, 'error'); }
}

// ==================== 报表分析 ====================
function renderReports() {
  const db = getDB();
  const now = Date.now();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const completedSales = db.salesOrders.filter(o => o.status === 'completed');
  const monthCompletedSales = completedSales.filter(o => {
    const ut = typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt;
    return ut >= monthStart;
  });

  const customerSales = {};
  completedSales.forEach(so => { if (!customerSales[so.customerId]) customerSales[so.customerId] = { count: 0, amount: 0 }; customerSales[so.customerId].count++; customerSales[so.customerId].amount += so.totalAmount; });

  const productSales = {};
  completedSales.forEach(so => { so.items.forEach(item => { if (!productSales[item.productId]) productSales[item.productId] = { name: item.productName, qty: 0, amount: 0 }; productSales[item.productId].qty += item.quantity; productSales[item.productId].amount += item.total; }); });

  const topProducts = Object.values(productSales).sort((a, b) => b.amount - a.amount).slice(0, 10);
  const topCustomers = Object.entries(customerSales).map(([id, data]) => {
    const c = db.customers.find(x => x.id === id);
    return { name: c ? c.name : '未知', ...data };
  }).sort((a, b) => b.amount - a.amount).slice(0, 10);

  const totalSalesAmount = completedSales.reduce((s, o) => s + o.totalAmount, 0);
  const totalPurchaseAmount = db.purchaseOrders.filter(o => o.status === 'received').reduce((s, o) => s + o.totalAmount, 0);
  const totalReceivable = db.salesOrders.filter(o => o.status === 'confirmed' || o.status === 'shipped').reduce((s, o) => s + o.totalAmount, 0);
  const totalPayable = db.purchaseOrders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.totalAmount, 0);

  document.getElementById('mainContent').innerHTML = `
    <div class="page-header"><h2>📈 报表分析</h2><div class="page-header-actions"><button class="btn btn-outline" onclick="window.print()">🖨️ 打印报表</button><button class="btn btn-primary" onclick="generateShareReport()">📄 导出报告</button></div></div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-card-header"><div class="stat-card-icon blue">💰</div><span class="stat-card-label">总销售额</span></div><div class="stat-card-value" style="font-size:22px;">${formatMoney(totalSalesAmount)}</div><div class="stat-card-change up">本月: ${formatMoney(monthCompletedSales.reduce((s,o)=>s+o.totalAmount,0))}</div></div>
      <div class="stat-card"><div class="stat-card-header"><div class="stat-card-icon orange">🛒</div><span class="stat-card-label">总采购额</span></div><div class="stat-card-value" style="font-size:22px;">${formatMoney(totalPurchaseAmount)}</div></div>
      <div class="stat-card"><div class="stat-card-header"><div class="stat-card-icon green">📥</div><span class="stat-card-label">应收账款</span></div><div class="stat-card-value" style="font-size:22px;">${formatMoney(totalReceivable)}</div></div>
      <div class="stat-card"><div class="stat-card-header"><div class="stat-card-icon red">📤</div><span class="stat-card-label">应付账款</span></div><div class="stat-card-value" style="font-size:22px;">${formatMoney(totalPayable)}</div></div>
    </div>
    <div class="charts-grid">
      <div class="chart-container full"><h3>🏆 Top 10 热销商品</h3><div class="chart-wrapper large"><canvas id="topProductChart"></canvas></div></div>
      <div class="chart-container full"><h3>👥 客户销售排行</h3><div class="chart-wrapper large"><canvas id="topCustomerChart"></canvas></div></div>
    </div>
    <div class="charts-grid">
      <div class="chart-container full"><h3>📊 月度销售额趋势</h3><div class="chart-wrapper large"><canvas id="monthlySalesChart"></canvas></div></div>
    </div>
  `;
  setTimeout(() => {
    if (topProducts.length > 0) renderTopProductChart(topProducts);
    if (topCustomers.length > 0) renderTopCustomerChart(topCustomers);
    renderMonthlySalesChart(db);
  }, 100);
}

function renderTopProductChart(products) {
  const canvas = document.getElementById('topProductChart'); if (!canvas) return;
  new Chart(canvas.getContext('2d'), { type: 'bar', data: { labels: products.map(p => p.name), datasets: [{ label: '销售额 (元)', data: products.map(p => p.amount), backgroundColor: '#1a73e8', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => (v/10000).toFixed(0)+'万' } } } } });
}

function renderTopCustomerChart(customers) {
  const canvas = document.getElementById('topCustomerChart'); if (!canvas) return;
  new Chart(canvas.getContext('2d'), { type: 'bar', data: { labels: customers.map(c => c.name), datasets: [{ label: '消费金额 (元)', data: customers.map(c => c.amount), backgroundColor: '#0d9e6c', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => (v/10000).toFixed(0)+'万' } } } } });
}

function renderMonthlySalesChart(db) {
  const canvas = document.getElementById('monthlySalesChart'); if (!canvas) return;
  const months = []; const saleAmounts = []; const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}/${d.getMonth()+1}`);
    const monthStart = d.getTime();
    const monthEnd = new Date(d.getFullYear(), d.getMonth()+1, 1).getTime();
    saleAmounts.push(db.salesOrders.filter(o => { const ut = typeof o.updatedAt === 'string' ? new Date(o.updatedAt).getTime() : o.updatedAt; return o.status === 'completed' && ut >= monthStart && ut < monthEnd; }).reduce((s, o) => s + o.totalAmount, 0));
  }
  new Chart(canvas.getContext('2d'), { type: 'bar', data: { labels: months, datasets: [{ label: '销售额 (元)', data: saleAmounts, backgroundColor: ['#1a73e8','#1a73e8','#1a73e8','#1a73e8','#1a73e8','#e53e3e'], borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => (v/10000).toFixed(0)+'万' } } } } });
}

// ==================== 系统设置 ====================
function renderSettings() {
  const db = getDB();
  document.getElementById('mainContent').innerHTML = `
    <div class="page-header"><h2>⚙️ 系统设置</h2></div>
    <div class="card"><div class="card-header"><h3>👤 用户管理</h3></div><div class="card-body">
      <p style="color:var(--gray-500);margin-bottom:12px;">当前系统共有 <strong>${db.users.length}</strong> 个用户账号 — 后端数据库统一存储，多人实时共享数据</p>
      <div class="table-container"><table>
        <thead><tr><th>头像</th><th>用户名</th><th>角色</th><th>权限</th><th>操作</th></tr></thead>
        <tbody>
          ${db.users.map(u => `<tr><td style="font-size:24px;">👤</td><td><strong>${u.name}</strong> ${u.id === currentUser.id ? '<span style="color:var(--success);font-size:12px;">(当前)</span>' : ''}</td><td>${u.role}</td><td>${Array.isArray(u.permissions) ? u.permissions.join(', ') : u.permissions}</td><td>${u.id !== currentUser.id ? `<button class="btn btn-sm btn-outline" onclick="switchUser('${u.id}')">切换到此账号</button>` : '<span style="color:var(--gray-400);font-size:12px;">当前账号</span>'}</td></tr>`).join('')}
        </tbody>
      </table></div>
    </div></div>
    <div class="card" style="margin-top:24px;"><div class="card-header"><h3>💾 数据管理</h3></div><div class="card-body">
      <div class="share-actions" style="flex-direction:column;gap:12px;align-items:flex-start;">
        <button class="btn btn-outline" onclick="exportAllData()">📥 导出全部数据 (JSON备份)</button>
        <div><button class="btn btn-outline" onclick="document.getElementById('importFile').click()">📤 从备份恢复数据</button><input type="file" id="importFile" accept=".json" style="display:none" onchange="importAllData(event)"></div>
      </div>
      <p style="color:var(--gray-500);font-size:12px;margin-top:12px;">
        ✅ 已升级为后端数据库存储 (SQLite)。所有用户共享同一份数据，修改实时同步。数据持久保存在服务器上，不会因浏览器清理而丢失。
      </p>
    </div></div>
    <div class="card" style="margin-top:24px;"><div class="card-header"><h3>🔗 分享与协作</h3></div><div class="card-body">
      <p style="color:var(--gray-500);margin-bottom:12px;">将当前页面地址分享给同事，他们在自己浏览器中打开即可看到同一份数据，实现真正的多人实时协作。</p>
      <p style="color:var(--gray-500);margin-bottom:16px;">🔄 当任意用户修改数据时，其他用户页面会自动刷新（通过 SSE 实时推送）。</p>
      <button class="btn btn-primary" onclick="openShareModal()">🔗 打开分享面板</button>
    </div></div>
  `;
}

function switchUser(userId) {
  const db = getDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return;
  currentUser = user;
  document.getElementById('currentUserName').textContent = user.name;
  const userSelect = document.getElementById('userSelect');
  if (userSelect) userSelect.value = user.id;
  renderDashboard();
  showToast(`已切换至：${user.name} (${user.role})`, 'info');
}

// ==================== 分享功能 ====================
function getShareUrl() {
  let url = window.location.href;
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    // 用后端上报的本机局域网 IP 替换，换 WiFi / 换电脑都不用改代码
    const lanIp = (_serverInfo && _serverInfo.lanIp) || '';
    if (lanIp && lanIp !== '127.0.0.1') {
      url = url.replace(/localhost|127\.0\.0\.1/g, lanIp);
    }
  }
  return url;
}

function openShareModal() {
  const shareUrl = getShareUrl();
  document.getElementById('shareUrl').value = shareUrl;
  document.getElementById('shareModal').style.display = 'flex';
  setTimeout(() => {
    const container = document.getElementById('qrCodeContainer');
    if (container && typeof QRCode !== 'undefined') {
      container.innerHTML = '';
      new QRCode(container, { text: shareUrl, width: 200, height: 200, colorDark: '#1a73e8', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    }
  }, 200);
}

function closeShareModal() { document.getElementById('shareModal').style.display = 'none'; }

function copyShareUrl() {
  const input = document.getElementById('shareUrl'); input.select(); document.execCommand('copy');
  showToast('链接已复制到剪贴板', 'success');
}

async function exportAllData() {
  try {
    const data = await api('/backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `哥曼尼照明_云端备份_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('数据已导出（云端数据库快照）', 'success');
  } catch (e) { showToast('导出失败: ' + e.message, 'error'); }
}

async function importAllData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const importData = JSON.parse(e.target.result);
      if (!importData.products) { showToast('无效的数据文件格式', 'error'); return; }
      if (!confirm('即将导入备份数据。当前云端数据将被覆盖，确认导入？')) return;
      // 批量导入
      for (const key of ['products','suppliers','customers']) {
        if (importData[key]) {
          for (const item of importData[key]) {
            try { await api(`/${key}`, { method: 'POST', body: item }); } catch(e2) { console.error('导入失败:', key, item.id); }
          }
        }
      }
      _cache.products = await api('/products');
      _cache.suppliers = await api('/suppliers');
      _cache.customers = await api('/customers');
      showToast('数据导入成功！', 'success');
      setTimeout(() => { renderDashboard(); }, 500);
    } catch (err) { showToast('文件解析失败', 'error'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function generateShareReport() {
  const db = getDB();
  const completedSales = db.salesOrders.filter(o => o.status === 'completed');
  const totalSales = completedSales.reduce((s, o) => s + o.totalAmount, 0);
  const totalPurchase = db.purchaseOrders.filter(o => o.status === 'received').reduce((s, o) => s + o.totalAmount, 0);
  const grossProfit = totalSales - totalPurchase;
  const margin = totalSales > 0 ? ((grossProfit / totalSales) * 100).toFixed(1) : 0;
  const now = new Date();
  const report = {
    title: '哥曼尼照明 — 运营报告快照',
    generatedAt: now.toISOString(),
    generatedBy: currentUser ? currentUser.name : 'Unknown',
    summary: {
      totalProducts: db.products.length, totalSuppliers: db.suppliers.length, totalCustomers: db.customers.length,
      totalSalesOrders: db.salesOrders.length, totalPurchaseOrders: db.purchaseOrders.length,
      totalSalesAmount: totalSales, totalPurchaseAmount: totalPurchase, grossProfit, grossMargin: margin + '%',
      lowStockCount: db.products.filter(p => p.stock < ms(p)).length,
    },
    topProducts: (() => {
      const ps = {};
      completedSales.forEach(so => so.items.forEach(item => {
        if (!ps[item.productId]) ps[item.productId] = { name: item.productName, qty: 0, amount: 0 };
        ps[item.productId].qty += item.quantity; ps[item.productId].amount += item.total;
      }));
      return Object.values(ps).sort((a,b) => b.amount - a.amount).slice(0, 10);
    })(),
    pendingOrders: {
      purchase: db.purchaseOrders.filter(o => o.status === 'draft' || o.status === 'confirmed').length,
      sales: db.salesOrders.filter(o => o.status === 'draft' || o.status === 'confirmed').length,
    }
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `哥曼尼照明_运营报告_${now.toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('运营报告已生成并下载', 'success');
}

// ==================== 模态框 ====================
function showModal(title, bodyHtml, footerHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalFooter').innerHTML = footerHtml || '<button class="btn btn-outline" onclick="closeModal()">关闭</button>';
  document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  window._poItems = null;
  window._soItems = null;
}

document.addEventListener('click', function(e) {
  if (e.target.id === 'modalOverlay') closeModal();
  if (e.target.id === 'shareModal') closeShareModal();
});

// ==================== 应用初始化 ====================
async function initApp() {
  showToast('正在连接服务器...', 'info');
  await loadAllData();

  currentUser = { id: 'admin', name: '管理员', role: '系统管理员', permissions: ['all'] };
  document.getElementById('currentUserName').textContent = currentUser.name;
  document.getElementById('userSelect').value = 'admin';

  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appMain').style.display = 'block';

  renderDashboard();
  updateOnlineCount();
  initRealtimeSync();

  setInterval(updateClock, 1000);
  setInterval(updateOnlineCount, 30000);

  showToast(`✅ 已连接云端数据库 · ${_cache.products.length} 个商品 · 数据实时同步`, 'success');
}

async function handleLogin() {
  const userId = document.getElementById('userSelect').value;
  if (!_cacheLoaded) await loadAllData();
  const user = _cache.users.find(u => u.id === userId);
  if (!user) return;
  currentUser = user;
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appMain').style.display = 'block';
  document.getElementById('currentUserName').textContent = user.name;
  renderDashboard();
  updateOnlineCount();
  initRealtimeSync();
  setInterval(updateClock, 1000);
  setInterval(updateOnlineCount, 30000);
}

function updateClock() {
  const now = new Date();
  const el = document.getElementById('currentTime');
  if (el) el.textContent = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function updateOnlineCount() {
  const el = document.getElementById('onlineUsers');
  if (el) el.innerHTML = `<span class="online-dot" style="color:var(--success)"></span> 🌐 云端数据库已连接 · 多人实时协作`;
}

// ==================== 事件绑定 ====================
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('userSelect').addEventListener('keydown', function(e) { if (e.key === 'Enter') handleLogin(); });

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function(e) { e.preventDefault(); const page = this.dataset.page; if (page) navigateTo(page); });
  });

  document.getElementById('menuToggle').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').style.display = document.getElementById('sidebar').classList.contains('open') ? 'block' : 'none';
  });

  document.getElementById('sidebarOverlay').addEventListener('click', function() {
    document.getElementById('sidebar').classList.remove('open');
    this.style.display = 'none';
  });

  document.getElementById('shareBtn').addEventListener('click', openShareModal);

  document.getElementById('logoutBtn').addEventListener('click', function() { location.reload(); });

  document.getElementById('modalClose').addEventListener('click', closeModal);

  updateClock();
  setInterval(updateClock, 1000);
});

window.addEventListener('hashchange', function() {
  const page = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(page);
});

if (window.location.hash) {
  setTimeout(() => navigateTo(window.location.hash.replace('#', '')), 100);
}
