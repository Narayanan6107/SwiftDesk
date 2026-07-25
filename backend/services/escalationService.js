/**
 * Escalation Service
 *
 * Two cron jobs run continuously after the server starts:
 *
 *   1. Queue Processor  (every 2 min by default)
 *      Tries to assign queued tickets to newly-available agents.
 *
 *   2. SLA Watcher      (every 5 min by default)
 *      Finds tickets that have blown past their SLA deadline and
 *      escalates them to the next support level.
 *
 * Escalation algorithm:
 *   a. Find tickets: isQueued=true OR status=Assigned, slaDeadline < now, !slaBreached
 *   b. For each ticket, determine current level (assignedLevel or PRIORITY_MIN_LEVEL[priority])
 *   c. Look up next level from ESCALATION_PATH
 *   d. If next level exists: try to find an agent at that level
 *   e. Reassign or re-queue at the new level, mark slaBreached=true
 *   f. Append to ticket.escalationHistory
 *   g. Write AuditLog entry
 */

const cron = require('node-cron');
const Ticket = require('../models/Ticket');
const AuditLog = require('../models/AuditLog');
const { findAndAssign, releaseTicket } = require('./assignmentEngine');
const { processQueue } = require('./queueManager');
const cfg = require('../config/automation');

const { checkSLABreaches, handleSLABreach } = require('./slaMonitor');

// ── SLA breach handler ────────────────────────────────────────────────────────

async function _handleSLABreach(ticket) {
  return handleSLABreach(ticket);
}

// ── SLA watcher job ───────────────────────────────────────────────────────────

async function _runSLAWatcher() {
  return checkSLABreaches();
}

// ── Queue processor job ───────────────────────────────────────────────────────

async function _runQueueProcessor() {
  const result = await processQueue();
  if (result.processed > 0) {
    console.log(
      `[Queue] Processed ${result.processed} | Assigned ${result.assigned} | Still queued ${result.stillQueued}`
    );
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Start both background cron jobs.
 * Call this once after MongoDB connects.
 */
function startCronJobs() {
  // Queue processor
  cron.schedule(cfg.QUEUE_CRON, async () => {
    try {
      await _runQueueProcessor();
    } catch (err) {
      console.error('[Cron:Queue] Unexpected error:', err.message);
    }
  });

  // SLA watcher
  cron.schedule(cfg.SLA_CRON, async () => {
    try {
      await _runSLAWatcher();
    } catch (err) {
      console.error('[Cron:SLA] Unexpected error:', err.message);
    }
  });

  console.log(`⏱  Queue processor cron: "${cfg.QUEUE_CRON}"`);
  console.log(`⏱  SLA watcher cron:     "${cfg.SLA_CRON}"`);
}

module.exports = { startCronJobs, _runSLAWatcher, _runQueueProcessor };
