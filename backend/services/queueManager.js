/**
 * Queue Manager
 *
 * Processes tickets that could not be assigned immediately because no eligible
 * agent was available. Runs on a configurable cron schedule.
 *
 * Algorithm:
 *   1. Fetch queued tickets ordered by queuedAt ASC (oldest first = FIFO).
 *   2. For each ticket, attempt assignment via the assignment engine.
 *   3. On success: dequeue, update ticket, update agent, write audit log.
 *   4. On failure (still no agent): leave in queue and continue to next.
 */

const Ticket = require('../models/Ticket');
const AuditLog = require('../models/AuditLog');
const { findAndAssign } = require('./assignmentEngine');
const cfg = require('../config/automation');

/**
 * Process all currently queued tickets.
 * Called by the cron job in escalationService.js.
 *
 * @returns {Promise<{ processed: number, assigned: number, stillQueued: number }>}
 */
async function processQueue() {
  const queuedTickets = await Ticket.find({ isQueued: true, status: 'Open' })
    .sort({ queuedAt: 1 })  // FIFO
    .limit(50);              // cap per run to avoid blocking the event loop

  if (!queuedTickets.length) {
    return { processed: 0, assigned: 0, stillQueued: 0 };
  }

  let assigned = 0;
  let stillQueued = 0;

  for (const ticket of queuedTickets) {
    try {
      const result = await findAndAssign(ticket.aiPriority || ticket.priority);

      if (result) {
        // ── Dequeue & assign ───────────────────────────────────────────────
        ticket.isQueued = false;
        ticket.queuedAt = null;
        ticket.status = 'Assigned';
        ticket.assignedAgent = result.agent._id;
        ticket.assignedLevel = result.assignedLevel;
        ticket.assignmentTimestamp = new Date();
        await ticket.save();

        // Trigger assignment notifications
        try {
          const Customer = require('../models/Customer');
          const customer = await Customer.findById(ticket.customer);
          if (customer) {
            const { notifyTicketAssigned } = require('./notificationService');
            notifyTicketAssigned(ticket, customer, result.agent).catch(err => 
              console.error('[QueueManager] Failed to send email:', err.message)
            );
          }
        } catch (notifErr) {
          console.error('[QueueManager] Notification error:', notifErr.message);
        }

        await AuditLog.create({
          ticket: ticket._id,
          ticketId: ticket.ticketId,
          eventType: 'queue_processed',
          details: {
            agentId: result.agent.agent_id,
            agentName: result.agent.name,
            assignedLevel: result.assignedLevel,
          },
          performedBy: 'queue_manager',
        });

        assigned++;
        console.log(`[QueueManager] Assigned queued ticket ${ticket.ticketId} → ${result.agent.name} (${result.assignedLevel})`);
      } else {
        stillQueued++;
      }
    } catch (err) {
      console.error(`[QueueManager] Error processing ticket ${ticket.ticketId}:`, err.message);
      stillQueued++;
    }
  }

  return { processed: queuedTickets.length, assigned, stillQueued };
}

/**
 * Add a ticket to the queue.
 * Updates the ticket in-place and saves it.
 *
 * @param {TicketDoc} ticket - Mongoose document (unsaved)
 * @param {string} priority - resolved priority
 * @returns {Promise<void>}
 */
async function enqueue(ticket, priority) {
  const slaHours = cfg.SLA_HOURS[priority] ?? 24;
  const now = new Date();

  ticket.isQueued = true;
  ticket.queuedAt = now;
  ticket.slaDeadline = new Date(now.getTime() + slaHours * 60 * 60 * 1000);
  ticket.status = 'Open';

  await ticket.save();

  await AuditLog.create({
    ticket: ticket._id,
    ticketId: ticket.ticketId,
    eventType: 'ticket_queued',
    details: {
      reason: 'No eligible agent available at time of submission',
      slaDeadline: ticket.slaDeadline,
      priority,
    },
    performedBy: 'assignment_engine',
  });

  console.log(`[QueueManager] Ticket ${ticket.ticketId} queued. SLA deadline: ${ticket.slaDeadline.toISOString()}`);
}

module.exports = { processQueue, enqueue };
