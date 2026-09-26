const { Router } = require('express');
const pool = require('../../db');
const messages = require('../constants/messages');
const { authenticateToken } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

// 每 1 小时服务时长结算 10 积分
const POINTS_PER_HOUR = 10;

// 服务时长只接受 1~12 的整数小时
const parseServiceHours = (value) => {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 12) {
    return null;
  }
  return hours;
};

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

// 志愿者提交服务时长（1~12 小时），订单进入“待居民确认”，此时不结算
router.put('/:id/submit', authenticateToken, asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const hours = parseServiceHours(req.body.service_hours);

  if (hours === null) {
    return res.status(400).json({ message: messages.orders.invalidServiceHours });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);

    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: messages.orders.notFound });
    }

    const order = orders[0];

    if (order.volunteer_id !== req.user.id) {
      await conn.rollback();
      return res.status(403).json({ message: messages.orders.onlyVolunteerSubmit });
    }

    if (order.status !== 'in_progress') {
      await conn.rollback();
      return res.status(400).json({ message: messages.orders.notInProgress });
    }

    await conn.query(
      "UPDATE orders SET status = 'pending_confirm', service_hours = ?, end_time = NOW() WHERE id = ?",
      [hours, orderId],
    );

    // 需求保持“已接单”，等居民确认后才完成
    await conn.commit();
    res.json({ message: messages.orders.submitted });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// 居民确认服务：订单与需求一起完成，并按每小时 10 分结算
// 只有待确认状态可以确认，重复确认不会再加积分
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

    if (order.status !== 'pending_confirm') {
      await conn.rollback();
      return res.status(400).json({ message: messages.orders.notPendingConfirm });
    }

    const hours = Number(order.service_hours);

    await conn.query("UPDATE orders SET status = 'completed' WHERE id = ?", [orderId]);
    await conn.query("UPDATE needs SET status = 'completed' WHERE id = ?", [order.need_id]);

    // 积分与服务时长只在确认这一步结算一次；订单此前未完成过，天然不会重复加分
    await conn.query(
      'UPDATE users SET service_hours = service_hours + ?, points = points + ? WHERE id = ?',
      [hours, hours * POINTS_PER_HOUR, order.volunteer_id],
    );

    await conn.commit();
    res.json({ message: messages.orders.completed, service_hours: hours, points: hours * POINTS_PER_HOUR });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// 居民退回：订单回到进行中，志愿者可修改时长后重新提交
router.put('/:id/return', authenticateToken, asyncHandler(async (req, res) => {
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

    if (order.status !== 'pending_confirm') {
      await conn.rollback();
      return res.status(400).json({ message: messages.orders.notPendingConfirm });
    }

    await conn.query(
      "UPDATE orders SET status = 'in_progress', service_hours = 0, end_time = NULL WHERE id = ?",
      [orderId],
    );

    await conn.commit();
    res.json({ message: messages.orders.returned });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
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
