const SupportAgent = require('../models/SupportAgent');
const Ticket = require('../models/Ticket');

/**
 * Reconciles and repairs support agent active ticket workloads to maintain database consistency.
 */
async function repairDatabase() {
  try {
    const tickets = await Ticket.find({
      $or: [
        { assignedAgent: { $ne: null } },
        { assignedEngineer: { $ne: null } },
      ],
    });

    for (const ticket of tickets) {
      let changed = false;
      if (ticket.assignedAgent) {
        const agentExists = await SupportAgent.findById(ticket.assignedAgent);
        if (!agentExists) {
          ticket.assignedAgent = null;
          ticket.status = 'New';
          ticket.isQueued = true;
          ticket.queuedAt = new Date();
          changed = true;
        }
      }
      if (ticket.assignedEngineer) {
        const agentExists = await SupportAgent.findById(ticket.assignedEngineer);
        if (!agentExists) {
          ticket.assignedEngineer = null;
          ticket.status = 'New';
          ticket.isQueued = true;
          ticket.queuedAt = new Date();
          changed = true;
        }
      }
      if (changed) {
        await ticket.save();
      }
    }

    const agents = await SupportAgent.find({});

    for (const agent of agents) {
      const actualActiveCount = await Ticket.countDocuments({
        assignedAgent: agent._id,
        status: { $nin: ['Resolved', 'Closed'] },
      });

      const normalizedCount = Math.max(0, Math.min(actualActiveCount, agent.max_capacity));
      const nextStatus = agent.status === 'offline' ? 'offline' : normalizedCount >= agent.max_capacity ? 'busy' : 'available';

      if (agent.active_tickets !== normalizedCount || agent.status !== nextStatus) {
        agent.active_tickets = normalizedCount;
        agent.status = nextStatus;
        await agent.save();
      }
    }

  } catch (err) {
    console.error('[ERROR] Critical system errors only');
  }
}

module.exports = { repairDatabase };
