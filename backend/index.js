// ML Priority Prediction + Queue Drainer enabled
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const ticketRoutes = require('./routes/tickets');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const notificationRouter = require('./routes/notifications');
const { errorHandler } = require('./middleware/errorHandler');
const { startCronJobs } = require('./services/escalationService');
const { startDailySummaryJob } = require('./jobs/dailySummaryJob');
const { repairDatabase } = require('./services/dbRepair');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/swiftdesk';

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request logging (dev only) ───────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/tickets', ticketRoutes);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/notifications', notificationRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// ── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Database + Server Start ──────────────────────────────────────────────────
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅  MongoDB connected:', MONGO_URI);
    app.listen(PORT, () => {
      console.log(`🚀  SwiftDesk backend running on http://localhost:${PORT}`);
      // Start background automation cron jobs only after DB is ready
      startCronJobs();
      startDailySummaryJob();

      repairDatabase().catch(err => console.error('[Startup Repair Error]', err.message));

      // Run auto-assignment worker on startup
      const { repairAndAssignExistingTickets } = require('./services/autoAssignmentWorker');
      repairAndAssignExistingTickets().catch(err => console.error('[Startup Worker Error]', err.message));
    });
  })
  .catch((err) => {
    console.error('❌  MongoDB connection error:', err.message);
    process.exit(1);
  });
