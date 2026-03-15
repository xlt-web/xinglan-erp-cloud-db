import express from 'express';
import cors from 'cors';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

const USERS = {
  admin: { password: '123456', role: '管理员' },
  finance: { password: '123456', role: '财务' },
  sales: { password: '123456', role: '销售' },
};

function ok(res, data = null, message = 'success') {
  return res.json({ code: 0, message, data });
}
function fail(res, message = 'error', code = 400) {
  return res.status(code).json({ code, message, data: null });
}
function auth(req, _res, next) {
  req.user = { username: req.header('x-user') || 'admin' };
  next();
}

app.get('/api/health', async (_req, res) => {
  const r = await pool.query('select now() as now');
  ok(res, { db_time: r.rows[0].now });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!USERS[username] || USERS[username].password !== password) {
    return fail(res, '账号或密码错误', 401);
  }
  ok(res, { token: 'demo-token', user: { username, role: USERS[username].role } }, '登录成功');
});

app.get('/api/summary', auth, async (_req, res) => {
  const [sales, debts, gtb] = await Promise.all([
    pool.query(`select coalesce(sum(total_amount),0) as total_sales,
                       coalesce(sum(case when sale_date = current_date then total_amount else 0 end),0) as today_sales,
                       count(*) filter (where sale_date = current_date) as today_orders
                from sales_orders where deleted_at is null`),
    pool.query(`select coalesce(sum(unpaid_amount),0) as total_debt
                from sales_orders where deleted_at is null`),
    pool.query(`select coalesce(sum(paid_amount),0) as gtb_pending
                from sales_orders where deleted_at is null and gtb_status = 'GTB未取'`)
  ]);
  ok(res, {
    total_sales: Number(sales.rows[0].total_sales),
    today_sales: Number(sales.rows[0].today_sales),
    today_orders: Number(sales.rows[0].today_orders),
    total_debt: Number(debts.rows[0].total_debt),
    gtb_pending: Number(gtb.rows[0].gtb_pending),
  });
});

app.get('/api/products', auth, async (_req, res) => {
  const r = await pool.query('select * from products order by id asc');
  ok(res, r.rows);
});

app.get('/api/customers', auth, async (_req, res) => {
  const r = await pool.query('select * from customers order by id asc');
  ok(res, r.rows);
});

app.get('/api/sales-orders', auth, async (_req, res) => {
  const r = await pool.query(`
    select id, order_no, sale_date, customer_id, customer_name, payment_method, bank_name,
           receive_type, total_qty, total_amount, paid_amount, unpaid_amount,
           payment_status, gtb_status, remark
    from sales_orders
    where deleted_at is null
    order by id desc
  `);
  ok(res, r.rows);
});

app.post('/api/sales-orders', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { sale_date, customer_id, payment_method, bank_name, receive_type, paid_amount, remark, items } = req.body || {};
    if (!customer_id) return fail(res, '请选择客户');
    if (!Array.isArray(items) || items.length === 0) return fail(res, '请先加入商品');
    await client.query('begin');

    const customerQ = await client.query('select * from customers where id = $1', [customer_id]);
    if (!customerQ.rowCount) throw new Error('客户不存在');
    const customer = customerQ.rows[0];

    let totalQty = 0;
    let totalAmount = 0;
    for (const item of items) {
      const pQ = await client.query('select * from products where id = $1 for update', [item.product_id]);
      if (!pQ.rowCount) throw new Error('产品不存在');
      const p = pQ.rows[0];
      const qty = Number(item.qty || 0);
      const unitPrice = Number(item.unit_price || p.price);
      const source = item.source || 'store';
      if (qty <= 0) throw new Error('数量必须大于0');
      if (source === 'store' && Number(p.store_stock) < qty) throw new Error(`门店库存不足：${p.name}`);
      if (source === 'factory' && Number(p.factory_stock) < qty) throw new Error(`工厂库存不足：${p.name}`);
      if (source === 'store') {
        await client.query('update products set store_stock = store_stock - $1 where id = $2', [qty, p.id]);
      } else {
        await client.query('update products set factory_stock = factory_stock - $1 where id = $2', [qty, p.id]);
      }
      totalQty += qty;
      totalAmount += qty * unitPrice;
    }

    const paid = Number(paid_amount || 0);
    const unpaid = Math.max(totalAmount - paid, 0);
    const paymentStatus = unpaid === 0 ? '已结清' : (paid > 0 ? '部分结清' : '欠款中');
    const gtbStatus = bank_name === 'GTB' && paid > 0 ? 'GTB未取' : '非GTB';
    const orderNo = 'SO' + Date.now();

    const so = await client.query(`
      insert into sales_orders
      (order_no, sale_date, customer_id, customer_name, payment_method, bank_name, receive_type,
       total_qty, total_amount, paid_amount, unpaid_amount, payment_status, gtb_status, remark)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      returning *
    `, [orderNo, sale_date, customer.id, customer.name, payment_method, bank_name, receive_type,
        totalQty, totalAmount, paid, unpaid, paymentStatus, gtbStatus, remark || '']);

    for (const item of items) {
      const pQ = await client.query('select * from products where id = $1', [item.product_id]);
      const p = pQ.rows[0];
      const qty = Number(item.qty || 0);
      const unitPrice = Number(item.unit_price || p.price);
      await client.query(`
        insert into sales_order_items
        (sales_order_id, product_id, product_name, model, source, qty, unit, unit_price, amount)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [so.rows[0].id, p.id, p.name, p.model, item.source || 'store', qty, p.unit, unitPrice, qty * unitPrice]);
    }

    await client.query('commit');
    ok(res, so.rows[0], '销售单已保存');
  } catch (e) {
    await client.query('rollback');
    fail(res, e.message || '保存失败', 400);
  } finally {
    client.release();
  }
});

app.post('/api/sales-orders/:id/repay', auth, async (req, res) => {
  const id = Number(req.params.id);
  const amount = Number(req.body?.amount || 0);
  if (amount <= 0) return fail(res, '还款金额必须大于0');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = await client.query('select * from sales_orders where id = $1 and deleted_at is null for update', [id]);
    if (!q.rowCount) throw new Error('销售单不存在');
    const order = q.rows[0];
    if (amount > Number(order.unpaid_amount)) throw new Error('还款金额不能大于剩余欠款');

    const newPaid = Number(order.paid_amount) + amount;
    const newUnpaid = Number(order.unpaid_amount) - amount;
    const status = newUnpaid === 0 ? '已结清' : '部分结清';

    await client.query('update sales_orders set paid_amount = $1, unpaid_amount = $2, payment_status = $3 where id = $4',
      [newPaid, newUnpaid, status, id]);

    await client.query(`insert into repayments (sales_order_id, customer_id, customer_name, repay_date, amount, method, bank_name)
      values ($1,$2,$3,current_date,$4,'bank','CB')`, [id, order.customer_id, order.customer_name, amount]);

    await client.query('commit');
    ok(res, { id, paid_amount: newPaid, unpaid_amount: newUnpaid, payment_status: status }, '还款成功');
  } catch (e) {
    await client.query('rollback');
    fail(res, e.message || '还款失败', 400);
  } finally {
    client.release();
  }
});

app.post('/api/sales-orders/:id/gtb-withdraw', auth, async (req, res) => {
  const id = Number(req.params.id);
  await pool.query(`update sales_orders set gtb_status = 'GTB已取' where id = $1 and deleted_at is null`, [id]);
  ok(res, { id }, '已标记为 GTB已取');
});

app.delete('/api/sales-orders/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = await client.query('select * from sales_orders where id = $1 and deleted_at is null for update', [id]);
    if (!q.rowCount) throw new Error('销售单不存在');
    const items = await client.query('select * from sales_order_items where sales_order_id = $1', [id]);
    for (const item of items.rows) {
      if (item.source === 'store') {
        await client.query('update products set store_stock = store_stock + $1 where id = $2', [item.qty, item.product_id]);
      } else {
        await client.query('update products set factory_stock = factory_stock + $1 where id = $2', [item.qty, item.product_id]);
      }
    }
    await client.query('update sales_orders set deleted_at = now() where id = $1', [id]);
    await client.query('commit');
    ok(res, { id }, '销售单已删除并恢复库存');
  } catch (e) {
    await client.query('rollback');
    fail(res, e.message || '删除失败', 400);
  } finally {
    client.release();
  }
});

app.get('/api/export/json', auth, async (_req, res) => {
  const [products, customers, salesOrders, repayments] = await Promise.all([
    pool.query('select * from products order by id asc'),
    pool.query('select * from customers order by id asc'),
    pool.query('select * from sales_orders where deleted_at is null order by id desc'),
    pool.query('select * from repayments order by id desc'),
  ]);
  ok(res, { products: products.rows, customers: customers.rows, sales_orders: salesOrders.rows, repayments: repayments.rows });
});

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`XINGLAN ERP server running on port ${port}`);
});
