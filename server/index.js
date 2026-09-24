/* ================================================================
   哥曼尼照明 灯具批发零售管理系统 - 后端服务
   Express + SQLite REST API
   ================================================================ */

const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3458;

// 获取本机局域网 IP（用于生成手机可访问的分享链接）
function getLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        candidates.push({ name, address: net.address });
      }
    }
  }
  // 优先常见网卡名，其次任意非虚拟网卡
  const preferred = candidates.find(c => /^(en|eth|wlan|wl)/i.test(c.name));
  return (preferred || candidates[0] || { address: '127.0.0.1' }).address;
}

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 静态文件服务（前端）
app.use(express.static(path.join(__dirname, '..')));

// ================================================================
// 数据库初始化
// ================================================================
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'lighting.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, category TEXT,
      unit TEXT, purchase_price REAL DEFAULT 0, sale_price REAL DEFAULT 0,
      wholesale_price REAL DEFAULT 0,
      stock REAL DEFAULT 0, min_stock REAL DEFAULT 0,
      created_at TEXT, updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, contact TEXT,
      phone TEXT, address TEXT, created_at TEXT, updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, contact TEXT,
      phone TEXT, address TEXT, type TEXT DEFAULT 'retail',
      created_at TEXT, updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY, order_no TEXT UNIQUE, supplier_id TEXT,
      items TEXT, total_amount REAL DEFAULT 0, status TEXT DEFAULT 'draft',
      note TEXT, created_by TEXT, created_at TEXT, updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sales_orders (
      id TEXT PRIMARY KEY, order_no TEXT UNIQUE, customer_id TEXT,
      items TEXT, total_amount REAL DEFAULT 0, status TEXT DEFAULT 'draft',
      note TEXT, created_by TEXT, created_at TEXT, updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_logs (
      id TEXT PRIMARY KEY, product_id TEXT, type TEXT, quantity REAL,
      related_order TEXT, operator TEXT, created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT, role TEXT, permissions TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT
    );
  `);

  // 种子数据
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt === 0) {
    seedData();
  }
}

function seedData() {
  const now = new Date().toISOString();

  const insertUser = db.prepare('INSERT INTO users (id, name, role, permissions) VALUES (?, ?, ?, ?)');
  insertUser.run('admin', '管理员', '系统管理员', '["all"]');
  insertUser.run('purchaser', '采购经理', '采购经理', '["view","purchase","products"]');
  insertUser.run('seller', '销售经理', '销售经理', '["view","sales","customers"]');
  insertUser.run('storekeeper', '仓管员', '仓管员', '["view","inventory"]');
  insertUser.run('guest', '访客', '只读用户', '["view"]');

  const insertProduct = db.prepare('INSERT INTO products (id,code,name,category,unit,purchase_price,sale_price,wholesale_price,stock,min_stock,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  // --- 吸顶灯 ---
  insertProduct.run('p1','GD-001','LED吸顶灯 圆形24W 现代简约','吸顶灯','个',18,38,26,200,50,now,now);
  insertProduct.run('p2','GD-002','LED吸顶灯 圆形36W','吸顶灯','个',25,52,36,150,40,now,now);
  insertProduct.run('p3','GD-003','LED吸顶灯 长方形48W','吸顶灯','个',38,78,55,120,30,now,now);
  // --- 吊灯 ---
  insertProduct.run('p4','GD-004','现代简约吊灯 三头（餐厅）','吊灯','套',65,135,92,60,20,now,now);
  insertProduct.run('p5','GD-005','北欧分子灯 五头','吊灯','套',85,178,120,40,15,now,now);
  insertProduct.run('p6','GD-006','水晶吊灯 八头（客厅）','吊灯','套',180,368,255,25,8,now,now);
  // --- 筒灯射灯 ---
  insertProduct.run('p7','GD-007','LED筒灯 8W 3寸 嵌入式','筒灯射灯','个',7.5,18,11,400,100,now,now);
  insertProduct.run('p8','GD-008','LED射灯 12W COB 可调角度','筒灯射灯','个',14,32,20,260,60,now,now);
  // --- 灯带光源 ---
  insertProduct.run('p9','GD-009','LED灯带 220V 2835贴片 5米/卷','灯带光源','卷',9,25,14,300,80,now,now);
  insertProduct.run('p10','GD-010','LED改造光源板 24W 圆形','灯带光源','片',8,22,12,45,50,now,now);
  insertProduct.run('p11','GD-011','E27 LED灯泡 9W','灯带光源','个',2.2,6.5,3.5,800,200,now,now);
  // --- 壁灯镜前灯 ---
  insertProduct.run('p12','GD-012','LED镜前灯 防雾 6W','壁灯镜前灯','个',16,39,24,90,25,now,now);
  insertProduct.run('p13','GD-013','现代简约壁灯 单头','壁灯镜前灯','个',28,65,40,70,20,now,now);
  // --- 台灯落地灯 ---
  insertProduct.run('p14','GD-014','现代简约台灯 木质底座','台灯落地灯','个',32,72,46,55,15,now,now);
  insertProduct.run('p15','GD-015','立式落地灯 布艺灯罩','台灯落地灯','个',68,158,98,30,10,now,now);
  // --- 风扇灯 / 浴霸 ---
  insertProduct.run('p16','GD-016','隐形风扇灯 36寸 带LED','风扇灯','套',165,348,235,8,10,now,now);
  insertProduct.run('p17','GD-017','风暖浴霸 三合一 集成吊顶','浴霸电器','台',155,338,225,12,20,now,now);
}

initDB();

// ================================================================
// API 路由
// ================================================================

// --- 用户 ---
app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.json(users.map(u => ({ ...u, permissions: JSON.parse(u.permissions) })));
});

app.post('/api/users', (req, res) => {
  const { name, role, permissions } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO users (id,name,role,permissions) VALUES (?,?,?,?)').run(id, name, role, JSON.stringify(permissions || ['view']));
  res.json({ id, name, role, permissions: permissions || ['view'] });
});

app.delete('/api/users/:id', (req, res) => {
  if (req.params.id === 'admin') return res.status(400).json({ error: '不能删除管理员' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- 商品 ---
app.get('/api/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY created_at DESC').all());
});

app.post('/api/products', (req, res) => {
  const { code, name, category, unit, purchasePrice, salePrice, wholesalePrice, stock, minStock } = req.body;
  const id = req.body.id || uuidv4();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE products SET code=?,name=?,category=?,unit=?,purchase_price=?,sale_price=?,wholesale_price=?,stock=?,min_stock=?,updated_at=? WHERE id=?')
      .run(code,name,category,unit,purchasePrice||0,salePrice||0,wholesalePrice||0,stock||0,minStock||0,now,id);
  } else {
    db.prepare('INSERT INTO products (id,code,name,category,unit,purchase_price,sale_price,wholesale_price,stock,min_stock,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,code,name,category,unit,purchasePrice||0,salePrice||0,wholesalePrice||0,stock||0,minStock||0,now,now);
  }
  broadcast('product_updated');
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  broadcast('product_updated');
  res.json({ success: true });
});

// --- 供应商 ---
app.get('/api/suppliers', (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers ORDER BY created_at DESC').all());
});

app.post('/api/suppliers', (req, res) => {
  const { code, name, contact, phone, address } = req.body;
  const id = req.body.id || uuidv4();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE suppliers SET code=?,name=?,contact=?,phone=?,address=?,updated_at=? WHERE id=?')
      .run(code,name,contact||'',phone||'',address||'',now,id);
  } else {
    db.prepare('INSERT INTO suppliers (id,code,name,contact,phone,address,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id,code,name,contact||'',phone||'',address||'',now,now);
  }
  broadcast('supplier_updated');
  res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
});

app.delete('/api/suppliers/:id', (req, res) => {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  broadcast('supplier_updated');
  res.json({ success: true });
});

// --- 客户 ---
app.get('/api/customers', (req, res) => {
  res.json(db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all());
});

app.post('/api/customers', (req, res) => {
  const { code, name, contact, phone, address, type } = req.body;
  const id = req.body.id || uuidv4();
  const now = new Date().toISOString();
  const custType = type === 'wholesale' ? 'wholesale' : 'retail';
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE customers SET code=?,name=?,contact=?,phone=?,address=?,type=?,updated_at=? WHERE id=?')
      .run(code,name,contact||'',phone||'',address||'',custType,now,id);
  } else {
    db.prepare('INSERT INTO customers (id,code,name,contact,phone,address,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id,code,name,contact||'',phone||'',address||'',custType,now,now);
  }
  broadcast('customer_updated');
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
});

app.delete('/api/customers/:id', (req, res) => {
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  broadcast('customer_updated');
  res.json({ success: true });
});

// --- 采购订单 ---
app.get('/api/purchase-orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM purchase_orders ORDER BY created_at DESC').all();
  res.json(orders.map(o => ({ ...o, items: JSON.parse(o.items || '[]') })));
});

app.post('/api/purchase-orders', (req, res) => {
  const { orderNo, supplierId, items, totalAmount, status, note, createdBy } = req.body;
  const id = req.body.id || uuidv4();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE purchase_orders SET order_no=?,supplier_id=?,items=?,total_amount=?,status=?,note=?,updated_at=? WHERE id=?')
      .run(orderNo,supplierId,JSON.stringify(items),totalAmount||0,status||'draft',note||'',now,id);
  } else {
    db.prepare('INSERT INTO purchase_orders (id,order_no,supplier_id,items,total_amount,status,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id,orderNo,supplierId,JSON.stringify(items),totalAmount||0,status||'draft',note||'',createdBy||'',now,now);
  }
  broadcast('order_updated');
  res.json({ id, orderNo, status: status || 'draft' });
});

app.delete('/api/purchase-orders/:id', (req, res) => {
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
  broadcast('order_updated');
  res.json({ success: true });
});

// 采购入库
app.post('/api/purchase-orders/:id/receive', (req, res) => {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.status !== 'confirmed') return res.status(400).json({ error: '只有已确认的订单才能入库' });

  const now = new Date().toISOString();
  const items = JSON.parse(order.items || '[]');

  const updateStock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?');
  const insertLog = db.prepare('INSERT INTO inventory_logs (id,product_id,type,quantity,related_order,operator,created_at) VALUES (?,?,?,?,?,?,?)');

  const txn = db.transaction(() => {
    for (const item of items) {
      updateStock.run(item.quantity, now, item.productId);
      insertLog.run(uuidv4(), item.productId, 'in', item.quantity, order.order_no, req.body.operator || '', now);
    }
    db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run('received', now, req.params.id);
  });
  txn();

  broadcast('order_updated');
  broadcast('inventory_updated');
  res.json({ success: true, status: 'received' });
});

// --- 销售订单 ---
app.get('/api/sales-orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM sales_orders ORDER BY created_at DESC').all();
  res.json(orders.map(o => ({ ...o, items: JSON.parse(o.items || '[]') })));
});

app.post('/api/sales-orders', (req, res) => {
  const { orderNo, customerId, items, totalAmount, status, note, createdBy } = req.body;
  const id = req.body.id || uuidv4();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE sales_orders SET order_no=?,customer_id=?,items=?,total_amount=?,status=?,note=?,updated_at=? WHERE id=?')
      .run(orderNo,customerId,JSON.stringify(items),totalAmount||0,status||'draft',note||'',now,id);
  } else {
    db.prepare('INSERT INTO sales_orders (id,order_no,customer_id,items,total_amount,status,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id,orderNo,customerId,JSON.stringify(items),totalAmount||0,status||'draft',note||'',createdBy||'',now,now);
  }
  broadcast('order_updated');
  res.json({ id, orderNo, status: status || 'draft' });
});

app.delete('/api/sales-orders/:id', (req, res) => {
  db.prepare('DELETE FROM sales_orders WHERE id = ?').run(req.params.id);
  broadcast('order_updated');
  res.json({ success: true });
});

// 销售出库（扣库存）
app.post('/api/sales-orders/:id/ship', (req, res) => {
  const order = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.status !== 'confirmed') return res.status(400).json({ error: '只有已确认的订单才能发货' });

  const now = new Date().toISOString();
  const items = JSON.parse(order.items || '[]');

  // 检查库存
  for (const item of items) {
    const product = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(item.productId);
    if (!product) return res.status(400).json({ error: `商品 ${item.productName} 不存在` });
    if (product.stock < item.quantity) return res.status(400).json({ error: `${product.name} 库存不足，当前库存 ${product.stock}` });
  }

  const updateStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?');
  const insertLog = db.prepare('INSERT INTO inventory_logs (id,product_id,type,quantity,related_order,operator,created_at) VALUES (?,?,?,?,?,?,?)');

  const txn = db.transaction(() => {
    for (const item of items) {
      updateStock.run(item.quantity, now, item.productId);
      insertLog.run(uuidv4(), item.productId, 'out', item.quantity, order.order_no, req.body.operator || '', now);
    }
    db.prepare('UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ?').run('shipped', now, req.params.id);
  });
  txn();

  broadcast('order_updated');
  broadcast('inventory_updated');
  res.json({ success: true, status: 'shipped' });
});

// --- 库存流水 ---
app.get('/api/inventory-logs', (req, res) => {
  const { productId, limit } = req.query;
  let sql = 'SELECT * FROM inventory_logs';
  const params = [];
  if (productId) {
    sql += ' WHERE product_id = ?';
    params.push(productId);
  }
  sql += ' ORDER BY created_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
  res.json(db.prepare(sql).all(...params));
});

// 库存调整
app.post('/api/inventory/adjust', (req, res) => {
  const { productId, quantity, reason, operator } = req.body;
  const now = new Date().toISOString();
  const type = quantity >= 0 ? 'in' : 'out';
  const absQty = Math.abs(quantity);

  db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?').run(quantity, now, productId);
  db.prepare('INSERT INTO inventory_logs (id,product_id,type,quantity,related_order,operator,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), productId, type, absQty, reason || '手动调整', operator || '', now);

  broadcast('inventory_updated');
  res.json({ success: true });
});

// --- 仪表盘统计 ---
app.get('/api/dashboard', (req, res) => {
  const now = new Date().toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30*86400000).toISOString();

  const productCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get().cnt;
  const supplierCount = db.prepare('SELECT COUNT(*) as cnt FROM suppliers').get().cnt;
  const customerCount = db.prepare('SELECT COUNT(*) as cnt FROM customers').get().cnt;
  const lowStockCount = db.prepare('SELECT COUNT(*) as cnt FROM products WHERE stock < min_stock').get().cnt;

  const pendingPO = db.prepare("SELECT COUNT(*) as cnt FROM purchase_orders WHERE status IN ('draft','confirmed')").get().cnt;
  const pendingSO = db.prepare("SELECT COUNT(*) as cnt FROM sales_orders WHERE status IN ('draft','confirmed')").get().cnt;

  const totalPurchase = db.prepare("SELECT COALESCE(SUM(total_amount),0) as total FROM purchase_orders WHERE status='received' AND created_at >= ?").get(thirtyDaysAgo).total;
  const totalSales = db.prepare("SELECT COALESCE(SUM(total_amount),0) as total FROM sales_orders WHERE status IN ('shipped','completed') AND created_at >= ?").get(thirtyDaysAgo).total;

  res.json({
    productCount, supplierCount, customerCount,
    lowStockCount, pendingPO, pendingSO,
    totalPurchase, totalSales
  });
});

// --- 报表 ---
app.get('/api/reports/sales-trend', (req, res) => {
  const data = db.prepare(`
    SELECT DATE(created_at) as date,
           SUM(CASE WHEN status IN ('shipped','completed') THEN total_amount ELSE 0 END) as amount
    FROM sales_orders
    WHERE created_at >= DATE('now', '-30 days')
    GROUP BY DATE(created_at) ORDER BY date
  `).all();
  res.json(data);
});

app.get('/api/reports/hot-products', (req, res) => {
  const data = db.prepare(`
    SELECT p.name, p.category, SUM(soi.quantity) as total_qty, SUM(soi.total) as total_amount
    FROM sales_orders so, json_each(so.items) soi
    JOIN products p ON p.id = json_extract(soi.value, '$.productId')
    WHERE so.status IN ('shipped','completed')
    GROUP BY p.id ORDER BY total_qty DESC LIMIT 10
  `).all();
  res.json(data);
});

// --- 备份/恢复 ---
app.get('/api/backup', (req, res) => {
  const products = db.prepare('SELECT * FROM products').all();
  const suppliers = db.prepare('SELECT * FROM suppliers').all();
  const customers = db.prepare('SELECT * FROM customers').all();
  const users = db.prepare('SELECT * FROM users').all();
  const purchaseOrders = db.prepare('SELECT * FROM purchase_orders').all().map(o => ({ ...o, items: JSON.parse(o.items || '[]') }));
  const salesOrders = db.prepare('SELECT * FROM sales_orders').all().map(o => ({ ...o, items: JSON.parse(o.items || '[]') }));
  const inventoryLogs = db.prepare('SELECT * FROM inventory_logs').all();

  res.json({
    exportedAt: new Date().toISOString(),
    company: '哥曼尼照明',
    products, suppliers, customers, users: users.map(u => ({ ...u, permissions: JSON.parse(u.permissions) })),
    purchaseOrders, salesOrders, inventoryLogs
  });
});

// --- 系统设置 ---
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  const { key, value } = req.body;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  res.json({ success: true });
});

// --- 服务信息（供前端生成手机可访问的分享链接）---
app.get('/api/server-info', (req, res) => {
  const lanIp = getLanIp();
  res.json({
    company: '哥曼尼照明',
    port: PORT,
    lanIp,
    lanUrl: `http://${lanIp}:${PORT}`
  });
});

// ================================================================
// 启动服务
// ================================================================
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`哥曼尼照明 灯具批发零售管理系统 后端服务已启动`);
  console.log(`本机访问: http://localhost:${PORT}`);
  console.log(`局域网访问: http://${getLanIp()}:${PORT}`);
  console.log(`数据库位置: ${DB_PATH}`);
});

// ================================================================
// 实时广播（Server-Sent Events 轻量替代 WebSocket）
// ================================================================
const clients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(':ok\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

function broadcast(event) {
  const msg = `event: ${event}\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`;
  clients.forEach(c => { try { c.write(msg); } catch(e) { clients.delete(c); } });
}
