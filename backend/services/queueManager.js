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
const { getPrioritySortValue, normalizePriority } = require('../config/automation');
const { logAssignmentFailed, logAssignmentSuccess, logError } = require('./assignmentLogger');

/**
 * Process all currently queued tickets.
 * Called by the cron job in escalationService.js.
 *
 * @returns {Promise<{ processed: number, assigned: number, stillQueued: number }>}
 */
async function processQueue() {
  const queuedTickets = await Ticket.find({ isQueued: true, status: 'New' });

  if (!queuedTickets.length) {
    return { processed: 0, assigned: 0, stillQueued: 0 };
  }

  // ── Primary pass: use priority-aware drain (L3→High first, L2→Medium first) ──
  // drainQueueForAllAvailableAgents iterates available agents least-loaded first,
  // and for each agent assigns the highest-priority ticket they can handle.
  const { drainQueueForAllAvailableAgents } = require('./queueDrainer');
  const primaryAssigned = await drainQueueForAllAvailableAgents();

  // ── Secondary pass: try direct findAndAssign for any remaining queued tickets ──
  const remaining = await Ticket.find({ isQueued: true, status: 'New' });
  remaining.forEach((ticket) => {
    ticket.priority = normalizePriority(ticket.aiPriority || ticket.priority);
  });
  remaining.sort(getPrioritySortValue);

  const ticketsToProcess = remaining.slice(0, 50);

  let assigned = primaryAssigned;
  let stillQueued = 0;

  for (const ticket of ticketsToProcess) {
    try {
      const result = await findAndAssign(
        ticket.aiPriority || ticket.predictedPriority || ticket.priority,
        ticket.ticketId,
        { category: ticket.aiCategory || ticket.predictedCategory || ticket.category }
      );

      if (result) {
        // ── Dequeue & assign ───────────────────────────────────────────────
        ticket.isQueued = false;
        ticket.queuedAt = null;
        ticket.status = 'Assigned';
        ticket.assignedAgent = result.agent._id;
        ticket.assignedEngineer = result.agent._id;
        ticket.assignedLevel = result.assignedLevel;
        ticket.requiredLevel = result.requiredLevel || ticket.requiredLevel;
        ticket.assignmentReason = result.assignmentReason;
        ticket.assignmentTimestamp = new Date();
        ticket.isQueued = false;
        ticket.queuedAt = null;
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
      } else {
        stillQueued++;
      }
    } catch (err) {
      logAssignmentFailed(ticket.ticketId, err.message);
      stillQueued++;
    }
  }

  return { processed: remaining.length, assigned, stillQueued };
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
  const normalizedPriority = normalizePriority(priority);
  const slaHours = cfg.SLA_HOURS[normalizedPriority] ?? 24;
  const now = new Date();

  if (!ticket.requiredLevel) {
    ticket.requiredLevel = cfg.getRequiredSupportLevel(
      ticket.aiPriority || ticket.predictedPriority || priority
    );
  }

  ticket.isQueued = true;
  ticket.queuedAt = now;
  ticket.slaDeadline = new Date(now.getTime() + slaHours * 60 * 60 * 1000);
  ticket.status = 'New';

  await ticket.save();

  await AuditLog.create({
    ticket: ticket._id,
    ticketId: ticket.ticketId,
    eventType: 'ticket_queued',
    details: {
      reason: 'No eligible agent available at time of submission',
      slaDeadline: ticket.slaDeadline,
      priority: normalizedPriority,
    },
    performedBy: 'assignment_engine',
  });

  if (process.env.DEBUG_ASSIGNMENT === 'true') {
    console.log(`[DEBUG] Queue ticket ${ticket.ticketId} queued. SLA deadline: ${ticket.slaDeadline.toISOString()}`);
  }
}

async function getQueueStatus() {
  const queuedTickets = await Ticket.find({ isQueued: true, status: 'New' }).sort(getPrioritySortValue);
  const byPriority = { High: 0, Medium: 0, Low: 0 };
  queuedTickets.forEach((ticket) => {
    const normalized = normalizePriority(ticket.aiPriority || ticket.priority);
    byPriority[normalized] = (byPriority[normalized] || 0) + 1;
  });

  return {
    totalQueued: queuedTickets.length,
    highPriorityCount: byPriority.High,
    mediumPriorityCount: byPriority.Medium,
    lowPriorityCount: byPriority.Low,
    oldestWaitingTicket: queuedTickets[0] ? {
      ticketId: queuedTickets[0].ticketId,
      priority: normalizePriority(queuedTickets[0].aiPriority || queuedTickets[0].priority),
      createdAt: queuedTickets[0].createdAt,
    } : null,
    nextAssignment: queuedTickets[0] ? {
      ticketId: queuedTickets[0].ticketId,
      priority: normalizePriority(queuedTickets[0].aiPriority || queuedTickets[0].priority),
      createdAt: queuedTickets[0].createdAt,
    } : null,
  };
}

module.exports = { processQueue, enqueue, getQueueStatus };
