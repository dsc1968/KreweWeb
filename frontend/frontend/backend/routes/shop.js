const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { upload } = require('../utils/files');
const { get__api_shop_payment_mode, get__api_shop_products, get__api_admin_shop_products, post__api_admin_shop_products, put__api_admin_shop_products__id___d__, delete__api_admin_shop_products__id___d__, get__api_shop_cart, post__api_shop_cart, put__api_shop_cart__itemId___d__, delete__api_shop_cart__itemId___d__, post__api_shop_checkout, get__api_shop_orders, get__api_admin_shop_orders, delete__api_admin_shop_orders__id___d__, put__api_admin_shop_orders__id___d___status, get__api_shop_paypal_config, post__api_shop_paypal_create_order, post__api_shop_paypal_capture_order } = require('../controllers/shopController');

router.get('/api/shop/payment-mode', authenticateToken, get__api_shop_payment_mode);
router.get('/api/shop/products', authenticateToken, get__api_shop_products);
router.get('/api/admin/shop/products', authenticateToken, get__api_admin_shop_products);
router.post('/api/admin/shop/products', authenticateToken, post__api_admin_shop_products);
router.put('/api/admin/shop/products/:id(\\d+)', authenticateToken, put__api_admin_shop_products__id___d__);
router.delete('/api/admin/shop/products/:id(\\d+)', authenticateToken, delete__api_admin_shop_products__id___d__);
router.get('/api/shop/cart', authenticateToken, get__api_shop_cart);
router.post('/api/shop/cart', authenticateToken, post__api_shop_cart);
router.put('/api/shop/cart/:itemId(\\d+)', authenticateToken, put__api_shop_cart__itemId___d__);
router.delete('/api/shop/cart/:itemId(\\d+)', authenticateToken, delete__api_shop_cart__itemId___d__);
router.post('/api/shop/checkout', authenticateToken, post__api_shop_checkout);
router.get('/api/shop/orders', authenticateToken, get__api_shop_orders);
router.get('/api/admin/shop/orders', authenticateToken, get__api_admin_shop_orders);
router.delete('/api/admin/shop/orders/:id(\\d+)', authenticateToken, delete__api_admin_shop_orders__id___d__);
router.put('/api/admin/shop/orders/:id(\\d+)/status', authenticateToken, put__api_admin_shop_orders__id___d___status);
router.get('/api/shop/paypal/config', authenticateToken, get__api_shop_paypal_config);
router.post('/api/shop/paypal/create-order', authenticateToken, post__api_shop_paypal_create_order);
router.post('/api/shop/paypal/capture-order', authenticateToken, post__api_shop_paypal_capture_order);

module.exports = router;
