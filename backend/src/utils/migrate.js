const pool = require('../../db');
const env = require('../config/env');
const logger = require('./logger');

// 订单状态机：进行中 -> 待居民确认 -> 已完成（居民退回则回到进行中）
// 老库的 orders.status 枚举缺少 pending_confirm，启动时做一次幂等补齐
const ensureOrderStatusEnum = async () => {
  const [columns] = await pool.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'status'`,
    [env.database.name],
  );

  if (columns.length === 0) {
    return;
  }

  if (!columns[0].COLUMN_TYPE.includes('pending_confirm')) {
    await pool.query(
      `ALTER TABLE orders
       MODIFY COLUMN status
       ENUM('in_progress','pending_confirm','completed','cancelled')
       DEFAULT 'in_progress'
       COMMENT '状态: in_progress-进行中, pending_confirm-待居民确认, completed-已完成, cancelled-已取消'`,
    );
    logger.info('✅ orders.status 枚举已补齐 pending_confirm 状态');
  }
};

const runMigrations = async () => {
  await ensureOrderStatusEnum();
};

module.exports = runMigrations;
