const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Ticket = require('../models/Ticket');
const SupportAgent = require('../models/SupportAgent');
const AuditLog = require('../models/AuditLog');
const { createError } = require('../middleware/errorHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getLevelPreferenceOrder } = require('../config/automation');
const { tryAssignToEngineer, releaseTicket, getAgentCapacityStatus } = require('../services/assignmentEngine');
const { getQueueStatus } = require('../services/queueManager');

// Ensure all routes under /api/admin require authentication and admin role
router.use(authenticate, requireAdmin);

/**
 * @route   GET /api/admin/engineers
 * @desc    Get all support engineers with workload and status
 */
router.get('/engineers', async (req, res, next) => {
  try {
    const agents = await SupportAgent.find({ isActive: true }).sort({ name: 1 });
    res.json({ success: true, data: agents });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   PATCH /api/admin/tickets/:ticketId/reassign
 * @desc    Reassign a ticket to a support engineer respecting routing capabilities
 */
router.patch('/tickets/:ticketId/reassign', async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { agentId } = req.body;

    if (!agentId) {
      return next(createError('agentId is required', 400));
    }

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return next(createError('Ticket not found', 404));
    }

    const agent = await SupportAgent.findById(agentId);
    if (!agent || !agent.isActive) {
      return next(createError('Eligible active support agent not found', 404));
    }

    // Respect L1/L2/L3 routing rules
    const eligibleLevels = getLevelPreferenceOrder(
      ticket.aiPriority || ticket.predictedPriority || ticket.priority
    );
    if (!eligibleLevels.includes(agent.level)) {
      return next(
        createError(
          `Agent level ${agent.level} is not eligible to handle ${ticket.priority} priority tickets. Eligible levels: ${eligibleLevels.join(', ')}`,
          400
        )
      );
    }

    if (!getAgentCapacityStatus(agent).eligible) {
      return next(createError('Selected engineer is at capacity and cannot receive another ticket', 409));
    }

    const oldAgentId = ticket.assignedAgent;

    // If assigned to the same agent, do nothing
    if (oldAgentId && oldAgentId.toString() === agent._id.toString()) {
      return res.json({ success: true, message: 'Ticket already assigned to this agent', data: ticket });
    }

    const capacityAssigned = await tryAssignToEngineer(agent._id, ticket.ticketId);
    if (!capacityAssigned) {
      return next(createError('Selected engineer is at capacity and cannot receive another ticket', 409));
    }

    if (oldAgentId) {
      await releaseTicket(oldAgentId);
    }

    // Update ticket
    ticket.assignedAgent = agent._id;
    ticket.assignedLevel = agent.level;
    ticket.status = 'Assigned';
    ticket.isQueued = false;
    ticket.queuedAt = null;
    ticket.assignmentTimestamp = new Date();
    await ticket.save();

    // Trigger processQueue to handle any unassigned tickets since capacity changed
    try {
      const { processQueue } = require('../services/queueManager');
      processQueue().catch(err => console.error('[Reassign Dequeue Error]', err.message));
    } catch (e) {
      console.error(e);
    }

    // Notify customer about the reassignment (in-app notification)
    try {
      const Customer = require('../models/Customer');
      const customer = await Customer.findById(ticket.customer);
      if (customer) {
        const { notifyTicketReassigned } = require('../services/notificationService');
        notifyTicketReassigned(ticket, customer).catch(err =>
          console.error('[Admin Reassign] Notification error:', err.message)
        );
      }
    } catch (notifErr) {
      console.error('[Admin Reassign] Notification error:', notifErr.message);
    }

    // Create Audit Log
    await AuditLog.create({
      ticket: ticket._id,
      ticketId: ticket.ticketId,
      eventType: 'agent_reassigned',
      details: {
        fromAgentId: oldAgentId || null,
        toAgentId: agent.agent_id,
        toAgentName: agent.name,
        assignedLevel: agent.level,
      },
      performedBy: 'admin',
    });

    res.json({
      success: true,
      message: `Ticket successfully reassigned to ${agent.name}`,
      data: ticket,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   GET /api/admin/analytics
 * @desc    Get dashboard analytics
 */
router.get('/analytics', async (req, res, next) => {
  try {
    // 1. Tickets by Status
    const statusAgg = await Ticket.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const status = { Open: 0, Assigned: 0, 'In Progress': 0, Resolved: 0, Closed: 0 };
    statusAgg.forEach(item => {
      if (item._id in status) status[item._id] = item.count;
    });

    // 2. Tickets by Priority
    const priorityAgg = await Ticket.aggregate([
      { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);
    const priority = { Low: 0, Medium: 0, High: 0 };
    priorityAgg.forEach(item => {
      if (item._id in priority) priority[item._id] = item.count;
    });

    // 3. Tickets by Category
    const categoryAgg = await Ticket.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    const category = {};
    categoryAgg.forEach(item => {
      if (item._id) category[item._id] = item.count;
    });

    // 4. SLA breaches
    const slaBreaches = await Ticket.countDocuments({ slaBreached: true });

    // 5. Workload by Level
    const levelAgg = await Ticket.aggregate([
      { $group: { _id: '$assignedLevel', count: { $sum: 1 } } }
    ]);
    const levels = { L1: 0, L2: 0, L3: 0, Queued: 0 };
    levelAgg.forEach(item => {
      if (item._id) levels[item._id] = item.count;
      else levels.Queued += item.count;
    });

    res.json({
      success: true,
      data: {
        status,
        priority,
        category,
        slaBreaches,
        levels,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   GET /api/admin/daily-summary/report
 * @desc    Get daily summary statistics
 */
router.get('/daily-summary/report', async (req, res, next) => {
  try {
    const total = await Ticket.countDocuments();
    const resolved = await Ticket.countDocuments({ status: 'Resolved' });
    const closed = await Ticket.countDocuments({ status: 'Closed' });
    const pending = await Ticket.countDocuments({ status: { $in: ['New', 'Assigned', 'In Progress'] } });
    const slaBreaches = await Ticket.countDocuments({ slaBreached: true });

    // Count escalations by counting non-empty escalationHistory arrays
    const escalations = await Ticket.countDocuments({
      'escalationHistory.0': { $exists: true },
    });

    // Engineer performance (active work + availability + resolved stats)
    const engineers = await SupportAgent.find({ isActive: true });
    const performance = engineers.map(eng => ({
      name: eng.name,
      email: eng.email,
      level: eng.level,
      status: eng.status,
      activeTickets: eng.active_tickets,
      maxCapacity: eng.max_capacity,
    }));

    res.json({
      success: true,
      data: {
        totalTickets: total,
        resolvedTickets: resolved + closed,
        pendingTickets: pending,
        slaBreaches,
        escalations,
        performance,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   POST /api/admin/daily-summary/trigger
 * @desc    Simulate/Trigger the daily summary email send
 */
router.post('/daily-summary/trigger', async (req, res, next) => {
  try {
    const total = await Ticket.countDocuments();
    const resolved = await Ticket.countDocuments({ status: 'Resolved' });
    const closed = await Ticket.countDocuments({ status: 'Closed' });
    const pending = await Ticket.countDocuments({ status: { $in: ['New', 'Assigned', 'In Progress'] } });
    const slaBreaches = await Ticket.countDocuments({ slaBreached: true });

    const summaryReport = {
      timestamp: new Date(),
      totalTickets: total,
      resolvedTickets: resolved + closed,
      pendingTickets: pending,
      slaBreaches,
    };

    console.log(`[DAILY SUMMARY EMAIL TRIGGERED] Sending summary report to admin@swiftdesk.com:`, summaryReport);

    res.json({
      success: true,
      message: 'Daily summary email successfully triggered and logged.',
      data: summaryReport,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   PATCH /api/admin/engineers/:agentId/status
 * @desc    Update engineer status; if set to 'offline', reassign all their active tickets.
 */
router.patch('/engineers/:agentId/status', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const { status } = req.body;

    if (!status) return next(createError('status is required', 400));

    const agent = await SupportAgent.findById(agentId);
    if (!agent) return next(createError('Support agent not found', 404));

    const prevStatus = agent.status;
    agent.status = status;
    await agent.save();

    let reassignedCount = 0;

    if (status === 'offline' && prevStatus !== 'offline') {
      // Find all unresolved tickets assigned to this agent
      const tickets = await Ticket.find({
        assignedAgent: agent._id,
        status: { $nin: ['Resolved', 'Closed'] },
      });

      const { findAndAssign } = require('../services/assignmentEngine');

      for (const ticket of tickets) {
        // Release from this offline agent
        ticket.assignedAgent = null;
        ticket.status = 'New';
        ticket.isQueued = true;
        ticket.queuedAt = new Date();
        await ticket.save();

        // Re-assign using the assignment engine
        const result = await findAndAssign(
          ticket.aiPriority || ticket.predictedPriority || ticket.priority,
          ticket.ticketId,
          { category: ticket.aiCategory || ticket.predictedCategory || ticket.category }
        );
        if (result) {
          reassignedCount++;
        }
      }

      // Force agent's active workload count to 0 since they went offline
      agent.active_tickets = 0;
      await agent.save();
    } else if (status === 'available' || status === 'busy') {
      try {
        const { processQueue } = require('../services/queueManager');
        processQueue().catch(err => console.error('[Agent Available Dequeue Error]', err.message));
      } catch (e) {
        console.error(e);
      }
    }

    res.json({
      success: true,
      message: `Status updated to ${status}.${reassignedCount > 0 ? ` Reassigned ${reassignedCount} tickets.` : ''}`,
      data: agent,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   POST /api/admin/rebalance
 * @desc    Rebalance all active tickets among eligible available support agents.
 */
router.post('/rebalance', async (req, res, next) => {
  try {
    const { findAndAssign } = require('../services/assignmentEngine');

    const tickets = await Ticket.find({
      status: { $in: ['New', 'Assigned', 'In Progress'] }
    }).sort({ priority: -1, createdAt: 1 });

    const agents = await SupportAgent.find({ isActive: true });
    for (const agent of agents) {
      const actualActiveCount = await Ticket.countDocuments({
        assignedAgent: agent._id,
        status: { $nin: ['Resolved', 'Closed'] },
      });
      agent.active_tickets = actualActiveCount;
      agent.status = agent.status === 'offline' ? 'offline' : actualActiveCount >= agent.max_capacity ? 'busy' : 'available';
      await agent.save();
    }

    let reassignedCount = 0;

    for (const ticket of tickets) {
      ticket.assignedAgent = null;
      ticket.status = 'New';
      ticket.isQueued = true;
      ticket.queuedAt = new Date();
      await ticket.save();

      const result = await findAndAssign(
        ticket.aiPriority || ticket.predictedPriority || ticket.priority,
        ticket.ticketId,
        { category: ticket.aiCategory || ticket.predictedCategory || ticket.category }
      );
      if (result) {
        reassignedCount++;
      }
    }

    res.json({
      success: true,
      message: `Successfully rebalanced ${reassignedCount} active tickets across support agents.`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   GET /api/admin/assignment-status
 * @desc    Get current health and diagnostics of the assignment engine
 */
router.get('/assignment-status', async (req, res, next) => {
  try {
    const totalOpenTickets = await Ticket.countDocuments({ status: { $nin: ['Resolved', 'Closed'] } });
    const assignedTickets = await Ticket.countDocuments({ status: { $nin: ['Resolved', 'Closed'] }, assignedAgent: { $ne: null } });
    const unassignedTickets = await Ticket.countDocuments({ status: { $nin: ['Resolved', 'Closed'] }, assignedAgent: null });

    const availableEngineers = await SupportAgent.countDocuments({
      status: { $in: ['available', 'busy'] },
      isActive: true,
      $expr: { $lt: ['$active_tickets', '$max_capacity'] }
    });

    const overloadedEngineers = await SupportAgent.countDocuments({
      isActive: true,
      $expr: { $gte: ['$active_tickets', '$max_capacity'] }
    });

    const { getLastAssignmentTimestamp } = require('../services/assignmentEngine');

    res.json({
      totalOpenTickets,
      assignedTickets,
      unassignedTickets,
      availableEngineers,
      overloadedEngineers,
      lastAssignmentRun: getLastAssignmentTimestamp(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   GET /api/admin/assignment-debug
 * @desc    Get complete diagnostic data for the auto-assignment system
 */
router.get('/queue-status', async (req, res, next) => {
  try {
    const status = await getQueueStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

router.get('/capacity-check', async (req, res, next) => {
  try {
    const engineers = await SupportAgent.find({ isActive: true }).sort({ name: 1 });
    const capacityView = engineers.map((engineer) => {
      const capacityStatus = getAgentCapacityStatus(engineer);
      return {
        name: engineer.name,
        activeTickets: engineer.active_tickets,
        maxCapacity: engineer.max_capacity,
        availableSlots: capacityStatus.availableSlots,
        status: capacityStatus.status,
      };
    });

    const overloadedEngineers = capacityView.filter((engineer) => engineer.activeTickets >= engineer.maxCapacity);

    res.json({
      success: true,
      engineers: capacityView,
      overloadedEngineers,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/assignment-debug', async (req, res, next) => {
  try {
    const queuedTickets = await Ticket.countDocuments({ isQueued: true });
    const openUnassignedTickets = await Ticket.countDocuments({
      status: 'New',
      $or: [
        { assignedAgent: null },
        { assignedEngineer: null }
      ]
    });

    const availableEngineers = await SupportAgent.countDocuments({
      status: 'available',
      isActive: true,
      $expr: { $lt: ['$active_tickets', '$max_capacity'] },
    });

    const { getLastAssignmentTimestamp, getLastAssignedTicketId } = require('../services/assignmentEngine');

    res.json({
      workerRunning: true,
      queuedTickets,
      openUnassignedTickets,
      lastAssignmentRun: getLastAssignmentTimestamp(),
      lastAssignedTicket: getLastAssignedTicketId(),
      availableEngineers,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
