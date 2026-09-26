const { Router } = require('express');
const pool = require('../../db');
const messages = require('../constants/messages');
const { authenticateToken } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

const POINTS_PER_HOUR = 10;

router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { status } = req.query;
  let sql = `SELECT o.*, n.title, n.type, n.address,
    u1.name as user_name, u2.name as volunteer_name
    FROM orders o
    LEFT JOIN needs n ON o.need_id = n.id
    LEFT JOIN users u1 ON o.user_id = u1.id
    LEFT JOIN users u2 ON o.volunteer_id = u2.id
    WHERE o.user_id = ? OR o.volunteer_id = ?`;
  const params = [req.user.id, req.user.id];

  if (status) {
    sql += ' AND o.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY o.created_at DESC';

  const [rows] = await pool.query(sql, params);
  res.json({ orders: rows });
}));

// 订单详情（含需求信息），供需求详情页展示服务进度
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const [orders] = await pool.query(
    `SELECT o.*, n.title, n.type, n.address, n.description, n.expected_time,
       u1.name as user_name, u2.name as volunteer_name
     FROM orders o
     LEFT JOIN needs n ON o.need_id = n.id
     LEFT JOIN users u1 ON o.user_id = u1.id
     LEFT JOIN users u2 ON o.volunteer_id = u2.id
     WHERE o.id = ?`,
    [req.params.id],
  );

  if (orders.length === 0) {
    return res.status(404).json({ message: messages.orders.notFound });
  }

  if (orders[0].user_id !== req.user.id && orders[0].volunteer_id !== req.user.id) {
    return res.status(403).json({ message: messages.orders.forbidden });
  }

  res.json({ order: orders[0] });
}));

// 志愿者提交服务时长（1-12 的整数小时），订单进入“待居民确认”，此时不结算
router.put('/:id/submit', authenticateToken, asyncHandler(async (req, res) => {
  const { service_hours } = req.body;
  const orderId = req.params.id;
  const hours = Number(service_hours);

  if (typeof service_hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 12) {
    return res.status(400).json({ message: messages.orders.invalidHours });
  }

  const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);

  if (orders.length === 0) {
    return res.status(404).json({ message: messages.orders.notFound });
  }

  const order = orders[0];

  if (order.volunteer_id !== req.user.id) {
    return res.status(403).json({ message: messages.orders.onlyVolunteerSubmit });
  }

  if (order.status !== 'in_progress') {
    return res.status(400).json({ message: messages.orders.notInProgress });
  }

  await pool.query(
    "UPDATE orders SET status = 'pending_confirm', service_hours = ?, end_time = NOW() WHERE id = ?",
    [hours, orderId],
  );

  res.json({ message: messages.orders.submitted });
}));

// 居民确认：需求才算完成，此刻才按每小时 10 积分结算一次（重复确认不加分）
router.put('/:id/confirm', authenticateToken, asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);

    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: messages.orders.notFound });
    }

    const order = orders[0];

    if (order.user_id !== req.user.id) {
      await conn.rollback();
      return res.status(403).json({ message: messages.orders.onlyResidentConfirm });
    }

    // 已完成订单再次确认：直接拒绝，积分不会重复发放
    if (order.status === 'completed') {
      await conn.rollback();
      return res.status(400).json({ message: messages.orders.alreadyCompleted });
    }

    if (order.status !== 'pending_confirm') {
      await conn.rollback();
      return res.status(400).json({ message: messages.orders.notPendingConfirm });
    }

    const [result] = await conn.query(
      "UPDATE orders SET status = 'completed' WHERE id = ? AND status = 'pending_confirm'",
      [orderId],
    );

    // 并发兜底：状态已被其他请求改动则不结算
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(400).json({ message: messages.orders.notPendingConfirm });
    }

    await conn.query(
      "UPDATE needs SET status = 'completed' WHERE id = ?",
      [order.need_id],
    );

    await conn.query(
      'UPDATE users SET service_hours = service_hours + ?, points = points + ? WHERE id = ?',
      [order.service_hours, Number(order.service_hours) * POINTS_PER_HOUR, order.volunteer_id],
    );

    await conn.commit();
    res.json({
      message: messages.orders.completed,
      service_hours: Number(order.service_hours),
      points: Number(order.service_hours) * POINTS_PER_HOUR,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// 居民退回：订单回到进行中，志愿者可修改时长后重新提交
router.put('/:id/reject', authenticateToken, asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);

  if (orders.length === 0) {
    return res.status(404).json({ message: messages.orders.notFound });
  }

  const order = orders[0];

  if (order.user_id !== req.user.id) {
    return res.status(403).json({ message: messages.orders.onlyResidentConfirm });
  }

  if (order.status !== 'pending_confirm') {
    return res.status(400).json({ message: messages.orders.notPendingConfirm });
  }

  await pool.query(
    "UPDATE orders SET status = 'in_progress', service_hours = 0, end_time = NULL WHERE id = ?",
    [orderId],
  );

  res.json({ message: messages.orders.rejected });
}));

router.post('/:id/review', authenticateToken, asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const orderId = req.params.id;
  const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);

  if (orders.length === 0) {
    return res.status(404).json({ message: messages.orders.notFound });
  }

  const targetId = orders[0].user_id === req.user.id
    ? orders[0].volunteer_id
    : orders[0].user_id;

  await pool.query(
    'INSERT INTO reviews (order_id, reviewer_id, target_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
    [orderId, req.user.id, targetId, rating, comment],
  );

  res.json({ message: messages.orders.reviewed });
}));

module.exports = router;
