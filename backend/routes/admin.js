const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Ticket = require('../models/Ticket');
const SupportAgent = require('../models/SupportAgent');
const AuditLog = require('../models/AuditLog');
const { createError } = require('../middleware/errorHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { _eligibleLevels } = require('../services/assignmentEngine');

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
    const eligibleLevels = _eligibleLevels(ticket.priority);
    if (!eligibleLevels.includes(agent.level)) {
      return next(
        createError(
          `Agent level ${agent.level} is not eligible to handle ${ticket.priority} priority tickets. Eligible levels: ${eligibleLevels.join(', ')}`,
          400
        )
      );
    }

    // Check capacity (warn but allow admin to override if needed, or enforce. Let's warn/allow or enforce. Let's enforce or just check capacity.)
    if (agent.active_tickets >= agent.max_capacity) {
      // Just a warning or strict check? Let's allow admins to force reassign, but update active_tickets properly.
    }

    const oldAgentId = ticket.assignedAgent;

    // If assigned to the same agent, do nothing
    if (oldAgentId && oldAgentId.toString() === agent._id.toString()) {
      return res.json({ success: true, message: 'Ticket already assigned to this agent', data: ticket });
    }

    // Update old agent workload
    if (oldAgentId) {
      await SupportAgent.findByIdAndUpdate(oldAgentId, [
        {
          $set: {
            active_tickets: { $max: [0, { $subtract: ['$active_tickets', 1] }] },
            status: {
              $cond: {
                if: { $lte: [{ $subtract: ['$active_tickets', 1] }, 0] },
                then: 'available',
                else: '$status',
              },
            },
          },
        },
      ]);
    }

    // Update new agent workload
    await SupportAgent.findByIdAndUpdate(agent._id, {
      $inc: { active_tickets: 1 },
      $set: {
        lastAssignedAt: new Date(),
        status: agent.active_tickets + 1 >= agent.max_capacity ? 'busy' : 'available',
      },
    });

    // Update ticket
    ticket.assignedAgent = agent._id;
    ticket.assignedLevel = agent.level;
    ticket.status = 'Assigned';
    ticket.isQueued = false;
    ticket.queuedAt = null;
    ticket.assignmentTimestamp = new Date();
    await ticket.save();

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
    const priority = { Low: 0, Medium: 0, High: 0, Critical: 0 };
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
    const pending = await Ticket.countDocuments({ status: { $in: ['Open', 'Assigned', 'In Progress'] } });
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
    const pending = await Ticket.countDocuments({ status: { $in: ['Open', 'Assigned', 'In Progress'] } });
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

module.exports = router;
