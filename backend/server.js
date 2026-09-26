const { createApp } = require('./src/app');
const env = require('./src/config/env');
const messages = require('./src/constants/messages');
const logger = require('./src/utils/logger');
const runMigrations = require('./src/utils/migrate');

const app = createApp();

runMigrations()
  .then(() => {
    app.listen(env.port, () => {
      logger.info(`${messages.server.started}，端口: ${env.port}`);
    });
  })
  .catch((err) => {
    logger.error('数据库迁移失败，服务终止启动:', err);
    process.exit(1);
  });
