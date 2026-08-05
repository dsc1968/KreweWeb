const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool, JWT_SECRET, REGISTRATION_CODE_TTL_MINUTES, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO, CONTACT_RECIPIENT } = require('../config/db');
const { ADMIN_EDIT_EXCLUDED_PAGES, HEX_COLOR_PATTERN, LENGTH_VALUE_PATTERN, BORDER_STYLE_VALUES, normalizePagePath, isAdminEditablePagePath, validateEditablePagePath, normalizeHexColor, normalizeLengthValue, normalizeBorderStyle, normalizePositionMode, normalizeCoordinate, normalizeOpacityValue, isAdmin, isShopManager } = require('../utils/validation');
const { smtpTransport, normalizeEmailAddress, isValidEmailAddress, generateVerificationCode, maskVerificationTarget, sendVerificationMail, dispatchVerificationCode } = require('../utils/email');
const { appDir, fileBackupsDir, imagesDir, listImagesInDirectory, resolveEditableFilePath, storage, upload } = require('../utils/files');
const { ashWednesdayDate, ashWednesdayISO, checkAndRunSeasonReset, currentSeasonYear, easterDate, parseSeasonEndConfig, performSeasonReset, resolveSeasonEndDate, seasonEndISO } = require('../utils/season');
const { ENV_CONFIG_ALLOWLIST, envFilePath, parseEnvFile, serializeEnvFile } = require('../utils/envConfig');
const { appDir: _bAppDir, BACKUP_CONFIG_KEYS, backupIdSafe, collectBackupAppFiles, DB_TABLES_INSERT_ORDER, execFileAsync, extractZip, fileBackupsDir: _bFb, isSafeColumnName, isSafeRclonePath, listLocalBackupsFromDir, listRcloneBackupManifests, listS3BackupManifests, makeS3Client, rcloneDeleteFile, rcloneDownloadFile, rcloneListFiles, rcloneRun, rcloneUploadFile, readBackupConfig, removeDir, zipDirectory } = require('../utils/backup');

// Normalizes a sizes input (array or comma string) to a de-duplicated,
// uppercased, comma-separated string, or null when there are no sizes.
function normalizeSizes(input) {
  if (input == null) return null;
  const parts = (Array.isArray(input) ? input : String(input).split(','))
    .map((s) => String(s).trim().toUpperCase())
    .filter((s) => s.length > 0 && s.length <= 12);
  const seen = new Set();
  const unique = [];
  for (const p of parts) { if (!seen.has(p)) { seen.add(p); unique.push(p); } }
  return unique.length ? unique.slice(0, 24).join(',') : null;
}

async function get__api_shop_payment_mode(req, res) {
  const env = parseEnvFile(fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '');
  res.json({ simulate: env.PAYMENT_SIMULATE === 'true' });
}

async function get__api_shop_products(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, name, description, price, image_path, category, stock_qty, sizes, is_donation
       FROM shop_products WHERE active = TRUE
       ORDER BY position ASC, id ASC`
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error('Failed to fetch shop products', err);
    res.status(500).json({ error: 'Unable to fetch products' });
  }
}

async function get__api_admin_shop_products(req, res) {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await pool.query(
      `SELECT id, name, description, price, image_path, category, stock_qty, sizes, is_donation, active, position, created_at
       FROM shop_products ORDER BY position ASC, id ASC`
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error('Failed to fetch admin shop products', err);
    res.status(500).json({ error: 'Unable to fetch products' });
  }
}

async function post__api_admin_shop_products(req, res) {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const { name, description, price, image_path, category, stock_qty, active, sizes } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Product name is required' });
  }
  const parsedPrice = parseFloat(price);
  if (!isFinite(parsedPrice) || parsedPrice < 0) {
    return res.status(400).json({ error: 'Invalid price' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO shop_products (name, description, price, image_path, category, stock_qty, active, sizes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        name.trim(),
        description ? description.trim() : null,
        parsedPrice,
        image_path ? image_path.trim() : null,
        category ? category.trim() : null,
        stock_qty != null && stock_qty !== '' ? parseInt(stock_qty, 10) : null,
        active !== false,
        normalizeSizes(sizes),
        req.user.userId,
      ]
    );
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('Failed to create product', err);
    res.status(500).json({ error: 'Unable to create product' });
  }
}

async function put__api_admin_shop_products__id___d__(req, res) {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  const { name, description, price, image_path, category, stock_qty, active, position, sizes } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Product name is required' });
  }
  const parsedPrice = parseFloat(price);
  if (!isFinite(parsedPrice) || parsedPrice < 0) {
    return res.status(400).json({ error: 'Invalid price' });
  }
  try {
    const result = await pool.query(
      `UPDATE shop_products
       SET name=$1, description=$2, price=$3, image_path=$4, category=$5,
           stock_qty=$6, active=$7, position=COALESCE($8, position), sizes=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [
        name.trim(),
        description ? description.trim() : null,
        parsedPrice,
        image_path ? image_path.trim() : null,
        category ? category.trim() : null,
        stock_qty != null && stock_qty !== '' ? parseInt(stock_qty, 10) : null,
        active !== false,
        position != null && position !== '' ? parseInt(position, 10) : null,
        normalizeSizes(sizes),
        id,
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('Failed to update product', err);
    res.status(500).json({ error: 'Unable to update product' });
  }
}

async function delete__api_admin_shop_products__id___d__(req, res) {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  try {
    const check = await pool.query('SELECT is_donation FROM shop_products WHERE id=$1', [id]);
    if (check.rows[0] && check.rows[0].is_donation) {
      return res.status(400).json({ error: 'The donation item cannot be deleted.' });
    }
    await pool.query('DELETE FROM shop_products WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete product', err);
    res.status(500).json({ error: 'Unable to delete product' });
  }
}

async function get__api_shop_cart(req, res) {
  try {
    const result = await pool.query(
      `SELECT c.id, c.quantity, c.size, c.custom_amount, p.id AS product_id, p.name,
              COALESCE(c.custom_amount, p.price) AS price, p.image_path, p.stock_qty, p.active, p.is_donation
       FROM shop_cart_items c
       JOIN shop_products p ON p.id = c.product_id
       WHERE c.user_id = $1 ORDER BY c.added_at ASC`,
      [req.user.userId]
    );
    res.json({ items: result.rows });
  } catch (err) {
    console.error('Failed to fetch cart', err);
    res.status(500).json({ error: 'Unable to fetch cart' });
  }
}

async function post__api_shop_cart(req, res) {
  const { product_id, quantity = 1, size } = req.body;
  const qty = parseInt(quantity, 10);
  if (!product_id || !Number.isInteger(qty) || qty < 1) {
    return res.status(400).json({ error: 'Invalid product or quantity' });
  }
  try {
    const prod = await pool.query(
      'SELECT id, sizes, is_donation FROM shop_products WHERE id=$1 AND active=TRUE', [product_id]
    );
    if (prod.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
    if (prod.rows[0].is_donation) {
      return res.status(400).json({ error: 'Use the donation option to add a donation.' });
    }
    const available = prod.rows[0].sizes
      ? prod.rows[0].sizes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : [];
    let chosenSize = '';
    if (available.length > 0) {
      chosenSize = (size == null ? '' : String(size).trim().toUpperCase());
      if (!available.includes(chosenSize)) {
        return res.status(400).json({ error: 'Please choose a valid size.' });
      }
    }
    const result = await pool.query(
      `INSERT INTO shop_cart_items (user_id, product_id, quantity, size) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, product_id, size)
       DO UPDATE SET quantity = shop_cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [req.user.userId, product_id, qty, chosenSize]
    );
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error('Failed to add to cart', err);
    res.status(500).json({ error: 'Unable to add to cart' });
  }
}

async function put__api_shop_cart__itemId___d__(req, res) {
  const itemId = parseInt(req.params.itemId, 10);
  const qty = parseInt(req.body.quantity, 10);
  if (!Number.isInteger(qty) || qty < 0) {
    return res.status(400).json({ error: 'Invalid quantity' });
  }
  try {
    if (qty === 0) {
      await pool.query('DELETE FROM shop_cart_items WHERE id=$1 AND user_id=$2', [itemId, req.user.userId]);
      return res.json({ removed: true });
    }
    const result = await pool.query(
      'UPDATE shop_cart_items SET quantity=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
      [qty, itemId, req.user.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Cart item not found' });
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error('Failed to update cart item', err);
    res.status(500).json({ error: 'Unable to update cart' });
  }
}

async function delete__api_shop_cart__itemId___d__(req, res) {
  const itemId = parseInt(req.params.itemId, 10);
  try {
    await pool.query('DELETE FROM shop_cart_items WHERE id=$1 AND user_id=$2', [itemId, req.user.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to remove cart item', err);
    res.status(500).json({ error: 'Unable to remove item' });
  }
}

async function post__api_shop_donation(req, res) {
  const amount = parseFloat(req.body && req.body.amount);
  if (!isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Enter a donation amount greater than $0.' });
  }
  if (amount > 100000) {
    return res.status(400).json({ error: 'Donation amount is too large.' });
  }
  const rounded = Math.round(amount * 100) / 100;
  try {
    const donationProd = await pool.query(
      'SELECT id FROM shop_products WHERE is_donation = TRUE AND active = TRUE ORDER BY id ASC LIMIT 1'
    );
    if (donationProd.rowCount === 0) return res.status(503).json({ error: 'Donations are not available.' });
    const donationId = donationProd.rows[0].id;
    // A single donation line per cart: replace any existing donation amount.
    await pool.query('DELETE FROM shop_cart_items WHERE user_id=$1 AND product_id=$2', [req.user.userId, donationId]);
    const result = await pool.query(
      `INSERT INTO shop_cart_items (user_id, product_id, quantity, size, custom_amount)
       VALUES ($1,$2,1,'',$3) RETURNING *`,
      [req.user.userId, donationId, rounded.toFixed(2)]
    );
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error('Failed to add donation', err);
    res.status(500).json({ error: 'Unable to add donation' });
  }
}

async function post__api_shop_checkout(req, res) {
  const { notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cartResult = await client.query(
      `SELECT c.id AS cart_id, c.quantity, c.size, p.id AS product_id, p.name,
              COALESCE(c.custom_amount, p.price) AS price, p.stock_qty, p.active
       FROM shop_cart_items c
       JOIN shop_products p ON p.id = c.product_id
       WHERE c.user_id = $1`,
      [req.user.userId]
    );
    if (cartResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const inactive = cartResult.rows.filter((r) => !r.active);
    if (inactive.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Some items are no longer available: ${inactive.map((r) => r.name).join(', ')}`,
      });
    }
    const userResult = await client.query(
      'SELECT full_name, email FROM users WHERE id=$1', [req.user.userId]
    );
    const buyer = userResult.rows[0];
    const total = cartResult.rows.reduce(
      (sum, row) => sum + parseFloat(row.price) * row.quantity, 0
    );
    const orderResult = await client.query(
      `INSERT INTO shop_orders (user_id, buyer_name, buyer_email, total_amount, notes, payment_status)
       VALUES ($1,$2,$3,$4,$5,'unpaid') RETURNING id`,
      [req.user.userId, buyer.full_name, buyer.email, total.toFixed(2), notes || null]
    );
    const orderId = orderResult.rows[0].id;
    for (const item of cartResult.rows) {
      await client.query(
        `INSERT INTO shop_order_items (order_id, product_id, product_name, unit_price, quantity, size)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [orderId, item.product_id, item.name, item.price, item.quantity, item.size || null]
      );
      if (item.stock_qty != null) {
        await client.query(
          'UPDATE shop_products SET stock_qty = GREATEST(0, stock_qty - $1) WHERE id=$2',
          [item.quantity, item.product_id]
        );
      }
    }
    await client.query('DELETE FROM shop_cart_items WHERE user_id=$1', [req.user.userId]);
    await client.query('COMMIT');
    res.json({ ok: true, order_id: orderId, total: total.toFixed(2) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Checkout failed', err);
    res.status(500).json({ error: 'Checkout failed. Please try again.' });
  } finally {
    client.release();
  }
}

async function get__api_shop_orders(req, res) {
  try {
    const orders = await pool.query(
      `SELECT id, total_amount, status, payment_status, notes, created_at
       FROM shop_orders WHERE user_id=$1 ORDER BY created_at DESC`,
      [req.user.userId]
    );
    const orderIds = orders.rows.map((r) => r.id);
    let itemRows = [];
    if (orderIds.length > 0) {
      const itemResult = await pool.query(
        `SELECT order_id, product_name, unit_price, quantity, size
         FROM shop_order_items WHERE order_id = ANY($1::int[])`,
        [orderIds]
      );
      itemRows = itemResult.rows;
    }
    const byOrder = {};
    itemRows.forEach((i) => {
      if (!byOrder[i.order_id]) byOrder[i.order_id] = [];
      byOrder[i.order_id].push(i);
    });
    res.json({ orders: orders.rows.map((o) => ({ ...o, items: byOrder[o.id] || [] })) });
  } catch (err) {
    console.error('Failed to fetch orders', err);
    res.status(500).json({ error: 'Unable to fetch orders' });
  }
}

async function get__api_admin_shop_orders(req, res) {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = 20;
    const offset = (page - 1) * limit;
    const payFilter = typeof req.query.payment_status === 'string' ? req.query.payment_status.trim() : '';
    const allowedPay = ['succeeded', 'declined', 'unpaid', 'pending'];
    const usePayFilter = allowedPay.includes(payFilter);
    const params = [];
    if (usePayFilter) params.push(payFilter);
    const whereSql = usePayFilter ? 'WHERE payment_status = $1' : '';
    const orders = await pool.query(
      `SELECT id, buyer_name, buyer_email, total_amount, status, payment_status, notes, created_at
       FROM shop_orders ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const countResult = await pool.query(`SELECT COUNT(*) FROM shop_orders ${whereSql}`, params);
    const total = parseInt(countResult.rows[0].count, 10);
    const orderIds = orders.rows.map((r) => r.id);
    let itemRows = [];
    if (orderIds.length > 0) {
      const itemResult = await pool.query(
        `SELECT order_id, product_name, unit_price, quantity, size
         FROM shop_order_items WHERE order_id = ANY($1::int[])`,
        [orderIds]
      );
      itemRows = itemResult.rows;
    }
    const byOrder = {};
    itemRows.forEach((i) => {
      if (!byOrder[i.order_id]) byOrder[i.order_id] = [];
      byOrder[i.order_id].push(i);
    });
    res.json({
      orders: orders.rows.map((o) => ({ ...o, items: byOrder[o.id] || [] })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Failed to fetch admin orders', err);
    res.status(500).json({ error: 'Unable to fetch orders' });
  }
}

async function delete__api_admin_shop_orders__id___d__(req, res) {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query('DELETE FROM shop_orders WHERE id=$1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete order', err);
    res.status(500).json({ error: 'Unable to delete order' });
  }
}

async function put__api_admin_shop_orders__id___d___status(req, res) {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'shipped', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const result = await pool.query(
      'UPDATE shop_orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ order: result.rows[0] });
  } catch (err) {
    console.error('Failed to update order status', err);
    res.status(500).json({ error: 'Unable to update order' });
  }
}

async function get__api_shop_paypal_config(req, res) {
  const cfg = getPayPalConfig();
  res.json({ client_id: cfg.clientId, mode: cfg.mode, configured: !!(cfg.clientId && cfg.clientSecret) });
}

async function post__api_shop_paypal_create_order(req, res) {
  try {
    const cfg = getPayPalConfig();
    if (!cfg.clientId || !cfg.clientSecret) return res.status(503).json({ error: 'PayPal is not configured' });
    const cartResult = await pool.query(
      `SELECT c.quantity, COALESCE(c.custom_amount, p.price) AS price, p.name, p.active
       FROM shop_cart_items c JOIN shop_products p ON p.id = c.product_id
       WHERE c.user_id = $1`,
      [req.user.userId]
    );
    if (cartResult.rowCount === 0) return res.status(400).json({ error: 'Cart is empty' });
    const inactive = cartResult.rows.filter((r) => !r.active);
    if (inactive.length) return res.status(400).json({ error: `Items unavailable: ${inactive.map((r) => r.name).join(', ')}` });
    const total = cartResult.rows.reduce((s, r) => s + parseFloat(r.price) * r.quantity, 0);
    const accessToken = await getPayPalAccessToken(cfg);
    const hostname = cfg.mode === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
    const ppOrder = await paypalHttpRequest(hostname, '/v2/checkout/orders', 'POST', {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }, { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: total.toFixed(2) }, description: 'Krewe Mystique Shop' }] });
    if (ppOrder.status !== 201) {
      console.error('PayPal create-order failed', ppOrder.body);
      return res.status(502).json({ error: 'Payment provider error. Please try again.' });
    }
    res.json({ paypal_order_id: ppOrder.body.id });
  } catch (err) {
    console.error('PayPal create-order error', err);
    res.status(500).json({ error: 'Unable to initiate payment' });
  }
}

async function post__api_shop_paypal_capture_order(req, res) {
  const { paypal_order_id, notes } = req.body;
  if (!paypal_order_id || typeof paypal_order_id !== 'string') {
    return res.status(400).json({ error: 'paypal_order_id is required' });
  }
  try {
    const cfg = getPayPalConfig();
    if (!cfg.clientId || !cfg.clientSecret) return res.status(503).json({ error: 'PayPal is not configured' });
    const accessToken = await getPayPalAccessToken(cfg);
    const hostname = cfg.mode === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
    const capture = await paypalHttpRequest(hostname, `/v2/checkout/orders/${paypal_order_id}/capture`, 'POST', {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }, {});
    if (capture.status !== 201 || capture.body.status !== 'COMPLETED') {
      console.error('PayPal capture failed', capture.body);
      try {
        const client = await pool.connect();
        try { await recordDeclinedOrder(client, req.user.userId, notes || null); }
        finally { client.release(); }
      } catch (declErr) { console.error('Failed to record declined PayPal order', declErr); }
      return res.status(402).json({ error: 'Payment was not completed or was declined.' });
    }
    // Payment confirmed — record order in DB
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cartResult = await client.query(
        `SELECT c.id AS cart_id, c.quantity, c.size, p.id AS product_id, p.name,
                COALESCE(c.custom_amount, p.price) AS price, p.stock_qty, p.active
         FROM shop_cart_items c JOIN shop_products p ON p.id = c.product_id
         WHERE c.user_id = $1`,
        [req.user.userId]
      );
      if (cartResult.rowCount === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cart is empty' }); }
      const userResult = await client.query('SELECT full_name, email FROM users WHERE id=$1', [req.user.userId]);
      const buyer = userResult.rows[0];
      const total = cartResult.rows.reduce((s, r) => s + parseFloat(r.price) * r.quantity, 0);
      const orderResult = await client.query(
        `INSERT INTO shop_orders (user_id, buyer_name, buyer_email, total_amount, notes, status, payment_status)
         VALUES ($1,$2,$3,$4,$5,'processing','succeeded') RETURNING id`,
        [req.user.userId, buyer.full_name, buyer.email, total.toFixed(2), notes || null]
      );
      const orderId = orderResult.rows[0].id;
      for (const item of cartResult.rows) {
        await client.query(
          `INSERT INTO shop_order_items (order_id, product_id, product_name, unit_price, quantity, size) VALUES ($1,$2,$3,$4,$5,$6)`,
          [orderId, item.product_id, item.name, item.price, item.quantity, item.size || null]
        );
        if (item.stock_qty != null) {
          await client.query('UPDATE shop_products SET stock_qty = GREATEST(0, stock_qty - $1) WHERE id=$2', [item.quantity, item.product_id]);
        }
      }
      await client.query('DELETE FROM shop_cart_items WHERE user_id=$1', [req.user.userId]);
      await client.query('COMMIT');
      res.json({ ok: true, order_id: orderId, total: total.toFixed(2) });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      console.error('DB order recording failed after PayPal capture', dbErr);
      res.status(500).json({ error: 'Payment received but order recording failed. Contact support.' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('PayPal capture-order error', err);
    res.status(500).json({ error: 'Payment capture failed' });
  }
}
// ── Stripe payments (added alongside PayPal; does not alter the PayPal flow) ──
function getStripeConfig() {
  const env = parseEnvFile(fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '');
  const mode = env.STRIPE_MODE === 'live' ? 'live' : 'test';
  return { secretKey: env.STRIPE_SECRET_KEY || '', publishableKey: env.STRIPE_PUBLISHABLE_KEY || '', mode };
}

// Raw HTTPS helper for the Stripe REST API (no external SDK dependency, mirroring
// the existing PayPal helper so nothing new is introduced to the dependency tree).
function stripeHttpRequest(method, urlPath, body) {
  const https = require('https');
  const cfg = getStripeConfig();
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = {
      'Authorization': 'Basic ' + Buffer.from(`${cfg.secretKey}:`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    };
    if (bodyStr) reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request({ hostname: 'api.stripe.com', path: urlPath, method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function get__api_shop_stripe_config(req, res) {
  const cfg = getStripeConfig();
  res.json({
    publishable_key: cfg.publishableKey,
    mode: cfg.mode,
    configured: !!(cfg.secretKey && cfg.publishableKey),
  });
}

async function post__api_shop_stripe_create_payment_intent(req, res) {
  try {
    const cfg = getStripeConfig();
    if (!cfg.secretKey || !cfg.publishableKey) return res.status(503).json({ error: 'Stripe is not configured' });
    const cartResult = await pool.query(
      `SELECT c.quantity, COALESCE(c.custom_amount, p.price) AS price, p.name, p.active
       FROM shop_cart_items c JOIN shop_products p ON p.id = c.product_id
       WHERE c.user_id = $1`,
      [req.user.userId]
    );
    if (cartResult.rowCount === 0) return res.status(400).json({ error: 'Cart is empty' });
    const inactive = cartResult.rows.filter((r) => !r.active);
    if (inactive.length) return res.status(400).json({ error: `Items unavailable: ${inactive.map((r) => r.name).join(', ')}` });
    const total = cartResult.rows.reduce((s, r) => s + parseFloat(r.price) * r.quantity, 0);
    const amountCents = Math.round(total * 100);
    // Restrict to card (which also carries Apple Pay / Google Pay) and US bank
    // transfer; this excludes Cash App Pay, Klarna, and other dashboard methods.
    const form = `amount=${amountCents}&currency=usd&description=${encodeURIComponent('Krewe Mystique Shop')}&metadata[source]=shop&payment_method_types[0]=card&payment_method_types[1]=us_bank_account`;
    const intent = await stripeHttpRequest('POST', '/v1/payment_intents', form);
    if (intent.status !== 200 || !intent.body || !intent.body.id) {
      console.error('Stripe create payment intent failed', intent.body);
      return res.status(502).json({ error: 'Payment provider error. Please try again.' });
    }
    res.json({ client_secret: intent.body.client_secret, publishable_key: cfg.publishableKey });
  } catch (err) {
    console.error('Stripe create payment intent error', err);
    res.status(500).json({ error: 'Unable to initiate payment' });
  }
}

async function post__api_shop_stripe_confirm(req, res) {
  const { payment_intent_id, notes } = req.body;
  if (!payment_intent_id || typeof payment_intent_id !== 'string') {
    return res.status(400).json({ error: 'payment_intent_id is required' });
  }
  try {
    const cfg = getStripeConfig();
    if (!cfg.secretKey || !cfg.publishableKey) return res.status(503).json({ error: 'Stripe is not configured' });
    const intentRes = await stripeHttpRequest('GET', `/v1/payment_intents/${encodeURIComponent(payment_intent_id)}`);
    const intent = intentRes.body;
    if (intentRes.status !== 200 || !intent || intent.status !== 'succeeded') {
      console.error('Stripe payment intent not succeeded', intent);
      try {
        const client = await pool.connect();
        try { await recordDeclinedOrder(client, req.user.userId, notes || null); }
        finally { client.release(); }
      } catch (declErr) { console.error('Failed to record declined Stripe order', declErr); }
      return res.status(402).json({ error: 'Payment was not completed or was declined.' });
    }
    // Payment confirmed — record order in DB (mirrors the PayPal capture flow)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cartResult = await client.query(
        `SELECT c.id AS cart_id, c.quantity, c.size, p.id AS product_id, p.name,
                COALESCE(c.custom_amount, p.price) AS price, p.stock_qty, p.active
         FROM shop_cart_items c JOIN shop_products p ON p.id = c.product_id
         WHERE c.user_id = $1`,
        [req.user.userId]
      );
      if (cartResult.rowCount === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cart is empty' }); }
      const userResult = await client.query('SELECT full_name, email FROM users WHERE id=$1', [req.user.userId]);
      const buyer = userResult.rows[0];
      const total = cartResult.rows.reduce((s, r) => s + parseFloat(r.price) * r.quantity, 0);
      const orderResult = await client.query(
        `INSERT INTO shop_orders (user_id, buyer_name, buyer_email, total_amount, notes, status, payment_status)
         VALUES ($1,$2,$3,$4,$5,'processing','succeeded') RETURNING id`,
        [req.user.userId, buyer.full_name, buyer.email, total.toFixed(2), notes || null]
      );
      const orderId = orderResult.rows[0].id;
      for (const item of cartResult.rows) {
        await client.query(
          `INSERT INTO shop_order_items (order_id, product_id, product_name, unit_price, quantity, size) VALUES ($1,$2,$3,$4,$5,$6)`,
          [orderId, item.product_id, item.name, item.price, item.quantity, item.size || null]
        );
        if (item.stock_qty != null) {
          await client.query('UPDATE shop_products SET stock_qty = GREATEST(0, stock_qty - $1) WHERE id=$2', [item.quantity, item.product_id]);
        }
      }
      await client.query('DELETE FROM shop_cart_items WHERE user_id=$1', [req.user.userId]);
      await client.query('COMMIT');
      res.json({ ok: true, order_id: orderId, total: total.toFixed(2) });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      console.error('DB order recording failed after Stripe confirm', dbErr);
      res.status(500).json({ error: 'Payment received but order recording failed. Contact support.' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Stripe confirm error', err);
    res.status(500).json({ error: 'Payment confirmation failed' });
  }
}

// Records an order marked as a declined/failed payment so it is visible in the
// admin orders list (with a 'declined' payment status) before any fulfillment.
// Does NOT clear the cart, so the buyer can retry the payment.
async function recordDeclinedOrder(client, userId, notes) {
  const cartResult = await client.query(
    `SELECT c.quantity, c.size, p.id AS product_id, p.name, COALESCE(c.custom_amount, p.price) AS price
     FROM shop_cart_items c JOIN shop_products p ON p.id = c.product_id
     WHERE c.user_id = $1`,
    [userId]
  );
  if (cartResult.rowCount === 0) return null;
  const userResult = await client.query('SELECT full_name, email FROM users WHERE id=$1', [userId]);
  const buyer = userResult.rows[0];
  if (!buyer) return null;
  const total = cartResult.rows.reduce((s, r) => s + parseFloat(r.price) * r.quantity, 0);
  const orderResult = await client.query(
    `INSERT INTO shop_orders (user_id, buyer_name, buyer_email, total_amount, notes, status, payment_status)
     VALUES ($1,$2,$3,$4,$5,'cancelled','declined') RETURNING id`,
    [userId, buyer.full_name, buyer.email, total.toFixed(2), notes]
  );
  const orderId = orderResult.rows[0].id;
  for (const item of cartResult.rows) {
    await client.query(
      `INSERT INTO shop_order_items (order_id, product_id, product_name, unit_price, quantity, size) VALUES ($1,$2,$3,$4,$5,$6)`,
      [orderId, item.product_id, item.name, item.price, item.quantity, item.size || null]
    );
  }
  return orderId;
}

function getPayPalConfig() {
  const env = parseEnvFile(fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '');
  const mode = env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
  const baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  return { clientId: env.PAYPAL_CLIENT_ID || '', clientSecret: env.PAYPAL_CLIENT_SECRET || '', mode, baseUrl };
}

function paypalHttpRequest(hostname, urlPath, method, headers, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (bodyStr) reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request({ hostname, path: urlPath, method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getPayPalAccessToken(cfg) {
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('PayPal credentials not configured');
  const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const hostname = cfg.mode === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
  const result = await paypalHttpRequest(hostname, '/v1/oauth2/token', 'POST', {
    'Authorization': 'Basic ' + credentials,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  }, 'grant_type=client_credentials');
  if (!result.body.access_token) throw new Error('Failed to obtain PayPal access token');
  return result.body.access_token;
}

// Records a Stripe decline that was caught client-side (Stripe.js surfaces an
// error before our confirm endpoint is invoked). This makes failed Stripe
// attempts visible in the admin orders list (payment_status='declined') before
// any fulfillment, mirroring recordDeclinedOrder for PayPal/server-side declines.
// The cart is intentionally NOT cleared, so the buyer can retry.
async function post__api_shop_stripe_declined(req, res) {
  const body = req.body || {};
  const notes = body.notes || null;
  try {
    const client = await pool.connect();
    try {
      const orderId = await recordDeclinedOrder(client, req.user.userId, notes);
      if (orderId == null) {
        return res.status(400).json({ error: 'Cart is empty' });
      }
      res.json({ ok: true, order_id: orderId });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Stripe declined recording error', err);
    res.status(500).json({ error: 'Unable to record declined payment' });
  }
}

module.exports = { delete__api_admin_shop_orders__id___d__,delete__api_admin_shop_products__id___d__,delete__api_shop_cart__itemId___d__,get__api_admin_shop_orders,get__api_admin_shop_products,get__api_shop_cart,get__api_shop_orders,get__api_shop_payment_mode,get__api_shop_paypal_config,get__api_shop_products,getPayPalAccessToken,getPayPalConfig,paypalHttpRequest,getStripeConfig,stripeHttpRequest,get__api_shop_stripe_config,post__api_shop_stripe_create_payment_intent,post__api_shop_stripe_confirm,post__api_shop_stripe_declined,post__api_shop_donation,post__api_admin_shop_products,post__api_shop_cart,post__api_shop_checkout,post__api_shop_paypal_capture_order,post__api_shop_paypal_create_order,put__api_admin_shop_orders__id___d___status,put__api_admin_shop_products__id___d__,put__api_shop_cart__itemId___d__, };
