const cron = require('node-cron');
const Ticket = require('../models/Ticket');
const Customer = require('../models/Customer');
const SupportAgent = require('../models/SupportAgent');
const AuditLog = require('../models/AuditLog');
const { findAndAssign, releaseTicket } = require('./assignmentEngine');
const { notifyTicketEscalated } = require('./notificationService');
const cfg = require('../config/automation');

/**
 * Handle a detected SLA breach for a ticket:
 * 1. Mark as breached
 * 2. Log audit event
 * 3. Escalates tier (L1 -> L2 -> L3) and re-assigns if next level exists
 * 4. Send email notifications
 */
async function handleSLABreach(ticket) {
  const currentLevel = ticket.assignedLevel || cfg.PRIORITY_MIN_LEVEL[ticket.aiPriority || ticket.priority];
  const nextLevel = cfg.ESCALATION_PATH[currentLevel];

  console.log(
    `[SLA Monitor] Ticket ${ticket.ticketId} breached SLA. Current level: ${currentLevel} → escalating to: ${nextLevel ?? 'none'}`
  );

  // Mark SLA as breached
  ticket.slaBreached = true;

  await AuditLog.create({
    ticket: ticket._id,
    ticketId: ticket.ticketId,
    eventType: 'sla_breached',
    details: {
      slaDeadline: ticket.slaDeadline,
      currentLevel,
      nextLevel,
      priority: ticket.aiPriority || ticket.priority,
    },
    performedBy: 'sla_watcher',
  });

  // Load customer details for notification
  const customer = await Customer.findById(ticket.customer);

  if (!nextLevel) {
    // Already at L3 — no further level escalation possible
    console.warn(`[SLA Monitor] Ticket ${ticket.ticketId} is already at L3 — no further escalation.`);
    await ticket.save();
    
    // Notify customer & admin about breach at L3
    if (customer) {
      await notifyTicketEscalated(ticket, customer, null, currentLevel, currentLevel);
    }
    return;
  }

  // Release the current agent (if any) so their capacity opens up
  const previousAgentId = ticket.assignedAgent;
  if (previousAgentId) {
    await releaseTicket(previousAgentId);
    ticket.assignedAgent = null;
  }

  // Try to find an agent at the next level
  const resolvedPriority = ticket.aiPriority || ticket.predictedPriority || ticket.priority;
  const result = await findAndAssign(resolvedPriority, ticket.ticketId, {
    category: ticket.aiCategory || ticket.predictedCategory || ticket.category,
  });

  const escalationEntry = {
    fromLevel: currentLevel,
    toLevel: nextLevel,
    reason: `SLA breached — escalated from ${currentLevel} to ${nextLevel}`,
    newAgent: result ? result.agent._id : null,
  };
  ticket.escalationHistory.push(escalationEntry);

  let nextLevelAgent = null;

  if (result) {
    ticket.assignedAgent = result.agent._id;
    ticket.assignedLevel = result.assignedLevel;
    ticket.requiredLevel = result.requiredLevel || ticket.requiredLevel;
    ticket.assignmentReason = result.assignmentReason;
    ticket.assignmentTimestamp = new Date();
    ticket.status = 'Assigned';
    ticket.isQueued = false;
    nextLevelAgent = result.agent;

    await AuditLog.create({
      ticket: ticket._id,
      ticketId: ticket.ticketId,
      eventType: 'ticket_escalated',
      details: {
        fromLevel: currentLevel,
        toLevel: result.assignedLevel,
        newAgentId: result.agent.agent_id,
        newAgentName: result.agent.name,
      },
      performedBy: 'sla_watcher',
    });

    console.log(
      `[SLA Monitor] Ticket ${ticket.ticketId} escalated → ${result.agent.name} (${result.assignedLevel})`
    );
  } else {
    // Still no agent at next level — keep queued
    ticket.isQueued = true;
    ticket.status = 'New';
    // Extend SLA deadline by the next level's SLA window
    const nextSlaHours = cfg.SLA_HOURS[resolvedPriority] ?? 4;
    ticket.slaDeadline = new Date(Date.now() + nextSlaHours * 60 * 60 * 1000 * 0.5); // 50% of SLA

    await AuditLog.create({
      ticket: ticket._id,
      ticketId: ticket.ticketId,
      eventType: 'ticket_escalated',
      details: {
        fromLevel: currentLevel,
        toLevel: nextLevel,
        result: 'no_agent_at_next_level',
        nextCheck: ticket.slaDeadline,
      },
      performedBy: 'sla_watcher',
    });

    console.warn(
      `[SLA Monitor] Ticket ${ticket.ticketId} escalated to ${nextLevel} but no agent available — re-queued.`
    );
  }

  await ticket.save();

  // Send escalation email notifications
  if (customer) {
    await notifyTicketEscalated(ticket, customer, nextLevelAgent, currentLevel, nextLevel);
  }
}

/**
 * Scan all open tickets for SLA breaches
 */
async function checkSLABreaches() {
  const now = new Date();
  const breachedTickets = await Ticket.find({
    slaDeadline: { $lte: now },
    slaBreached: false,
    status: { $nin: ['Resolved', 'Closed'] },
  }).limit(50);

  if (!breachedTickets.length) return;

  console.log(`[SLA Monitor] ${breachedTickets.length} SLA breach(es) detected`);

  for (const ticket of breachedTickets) {
    try {
      await handleSLABreach(ticket);
    } catch (err) {
      console.error(`[SLA Monitor] Error handling breach for ${ticket.ticketId}:`, err.message);
    }
  }
}

/**
 * Bootstrap SLA monitor node-cron job
 */
function startSlaMonitorJob() {
  cron.schedule(cfg.SLA_CRON, async () => {
    try {
      await checkSLABreaches();
    } catch (err) {
      console.error('[SLA Monitor Cron] Unexpected error:', err.message);
    }
  });
  console.log(`⏱  SLA Monitor Cron scheduled: "${cfg.SLA_CRON}"`);
}

module.exports = {
  checkSLABreaches,
  handleSLABreach,
  startSlaMonitorJob,
};
