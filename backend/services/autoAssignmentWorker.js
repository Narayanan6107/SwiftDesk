/**
 * Auto Assignment Worker
 *
 * Runs at server startup to:
 *   1. Repair DB consistency (recalculate agent active_tickets from actual assignments).
 *   2. Classify any unassigned tickets missing aiPriority via ML NLP.
 *   3. Sequentially attempt assignment for each Open/unassigned ticket.
 *   4. Queue tickets that cannot be assigned immediately.
 *   5. Drain the queue for all available agents using priority-aware routing.
 */

const Ticket = require('../models/Ticket');
const SupportAgent = require('../models/SupportAgent');
const { findAndAssign } = require('./assignmentEngine');
const { repairDatabase } = require('./dbRepair');
const { enqueue } = require('./queueManager');
const { drainQueueForAllAvailableAgents } = require('./queueDrainer');
const { logWorker, logAssignmentFailed, logError } = require('./assignmentLogger');

/**
 * Classify an unassigned ticket's priority using the ML service if it's missing.
 * Updates aiPriority and predictedPriority on the ticket document (in-place, not saved).
 *
 * @param {TicketDoc} ticket
 */
async function ensureTicketPriority(ticket) {
  // If priority is already set from ML, skip
  if (ticket.aiPriority || ticket.predictedPriority) return;

  try {
    const { classify } = require('./mlClassifier');
    const result = await classify(ticket.subject || '', ticket.description || '');

    ticket.aiPriority = result.priority;
    ticket.predictedPriority = result.priority;
    ticket.aiCategory = result.category || ticket.category;
    ticket.predictedCategory = result.category || ticket.category;
    ticket.aiConfidence = result.confidence;

    logWorker(`[ML] Predicted priority for ${ticket.ticketId}: ${result.priority} (confidence: ${(result.confidence * 100).toFixed(1)}%)`);
  } catch (err) {
    logWorker(`[ML] Could not predict priority for ${ticket.ticketId}: ${err.message} — using stored priority`);
  }
}

/**
 * Main startup function.
 * Repairs DB, classifies, assigns existing open tickets, then drains the queue.
 */
async function repairAndAssignExistingTickets() {
  logWorker('[SERVER] Backend started — running auto assignment worker');

  try {
    // Step 1: Repair database consistency
    await repairDatabase();

    // Step 2: Find Open, unassigned tickets
    const unassignedTickets = await Ticket.find({
      status: 'New',
      $or: [
        { assignedAgent: null },
        { assignedEngineer: null },
      ],
    }).sort({ createdAt: 1 }); // oldest first

    logWorker(`[WORKER] Found ${unassignedTickets.length} unassigned open tickets`);

    if (!unassignedTickets.length) {
      // Still drain queue in case previously queued tickets have available engineers
      const drained = await drainQueueForAllAvailableAgents();
      if (drained > 0) logWorker(`[WORKER] Queue drain: assigned ${drained} tickets from queue`);
      return;
    }

    logWorker('[WORKER] Auto assignment started');

    let successCount = 0;
    let queuedCount = 0;
    let failedCount = 0;
    const batchSize = 5;

    // Process sequentially in batches to avoid race conditions on agent capacities
    for (let i = 0; i < unassignedTickets.length; i += batchSize) {
      const batch = unassignedTickets.slice(i, i + batchSize);

      for (const ticket of batch) {
        try {
          // Always re-fetch the ticket to avoid stale state
          const freshTicket = await Ticket.findById(ticket._id);
          if (!freshTicket) continue;
          if (freshTicket.assignedAgent && freshTicket.assignedEngineer) continue;
          if (freshTicket.status !== 'New') continue;

          // Step 3: Ensure priority is ML-classified
          await ensureTicketPriority(freshTicket);

          const priority = freshTicket.aiPriority || freshTicket.predictedPriority || freshTicket.priority || 'Medium';
          const category = freshTicket.aiCategory || freshTicket.predictedCategory || freshTicket.category || null;

          // Step 4: Attempt assignment
          const result = await findAndAssign(priority, freshTicket.ticketId, { category });

          if (result) {
            freshTicket.assignedAgent = result.agent._id;
            freshTicket.assignedEngineer = result.agent._id;
            freshTicket.assignedLevel = result.assignedLevel;
            freshTicket.requiredLevel = result.requiredLevel || freshTicket.requiredLevel;
            freshTicket.assignmentReason = result.assignmentReason;
            freshTicket.status = 'Assigned';
            freshTicket.isQueued = false;
            freshTicket.queuedAt = null;
            freshTicket.assignmentTimestamp = new Date();
            await freshTicket.save();

            successCount++;
            logWorker(`[WORKER] Assigned ${freshTicket.ticketId} (${priority}) → ${result.agent.name} (${result.agent.level})`);
          } else {
            // No engineer available — enqueue with priority ordering
            if (!freshTicket.isQueued) {
              await enqueue(freshTicket, priority);
              queuedCount++;
              logWorker(`[WORKER] Queued ${freshTicket.ticketId} (${priority}) — no eligible engineer available`);
            }
          }
        } catch (ticketErr) {
          failedCount++;
          logError(`Auto assignment failed for ticket: ${ticketErr.message}`);
        }
      }
    }

    logWorker(`[WORKER] Assignment complete — Assigned: ${successCount}, Queued: ${queuedCount}, Failed: ${failedCount}`);

    // Step 5: Drain queue for any remaining available agents
    if (queuedCount > 0) {
      const drained = await drainQueueForAllAvailableAgents();
      if (drained > 0) logWorker(`[WORKER] Queue drain: additionally assigned ${drained} tickets`);
    }
  } catch (err) {
    logError(`Auto assignment worker failed: ${err.message}`);
  }
}

module.exports = {
  repairAndAssignExistingTickets,
  startAutoAssignment: repairAndAssignExistingTickets,
};
