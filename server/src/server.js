import mongoose from 'mongoose';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectDB } from './config/db.js';
import { startScheduler } from './services/scheduler.js';
import { startRollupJob } from './services/rollupJob.js';
import { startPlanEnforcer } from './services/billingService.js';
import { migrateLegacyData } from './services/workspaceService.js';
import { runSecurityMigration } from './services/securityMigration.js';
import { startLeaderElection, releaseLeadership } from './services/leader.js';

// Registered once, before anything async, so startup failures are logged too.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'UNCAUGHT EXCEPTION! 💥 Shutting down...');
  process.exit(1);
});

const app = createApp();

connectDB().then(async () => {
  // Bring pre-workspace data into the workspace model before serving traffic.
  await migrateLegacyData(logger).catch((err) => logger.error(`Migration failed: ${err.message}`));
  // Encrypt any plaintext secrets and finish key rotations before serving traffic.
  await runSecurityMigration(logger).catch((err) => logger.error(`Security migration failed: ${err.message}`));
  // Exactly one instance runs background jobs, however many are deployed.
  await startLeaderElection();

  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`Server is running on port ${env.PORT} in ${env.NODE_ENV} mode`);
    startScheduler();
    startRollupJob();
    startPlanEnforcer();
  });

  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'UNHANDLED REJECTION! 💥 Shutting down...');
    server.close(() => process.exit(1));
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received — closing gracefully.`);
    server.close(async () => {
      await releaseLeadership();
      await mongoose.connection.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
});
