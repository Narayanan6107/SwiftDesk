const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Ticket = require('../models/Ticket');
const Customer = require('../models/Customer');
const AuditLog = require('../models/AuditLog');
const { createError } = require('../middleware/errorHandler');
const { classifyTicket } = require('../services/geminiService');
const { findAndAssign } = require('../services/assignmentEngine');
const { enqueue } = require('../services/queueManager');
const { authenticate } = require('../middleware/auth');
const cfg = require('../config/automation');
const { getRequiredSupportLevel, getSlaPriority } = cfg;
const { logAssignmentSuccess, logAssignmentFailed, logError } = require('../services/assignmentLogger');
const { mergeCustomerDetails, validateCustomerDetails } = require('../services/customerDetails');

// ── Ticket ID generator ───────────────────────────────────────────────────────

/** Generates a short, human-readable ticket ID like SD-A1B2C3 */
function generateTicketId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let id = '';
  for (let i = 0; i < 7; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `SD-${id}`;
}

// ── POST /api/tickets — Automation pipeline ───────────────────────────────────

/**
 * @route   POST /api/tickets
 * @desc    Accept a ticket, classify it (ML → LLM fallback), assign to agent or queue.
 * @access  Public
 */
router.post('/', authenticate, async (req, res, next) => {
  try {
    const {
      subject,
      description,
      category: userCategory,
      priority: userPriority,
      channel,
      customer: customerPayload,
      metadata,
      external_ref,
      tags,
    } = req.body;

    // ── 1. Input validation ────────────────────────────────────────────────
    if (!subject?.trim())
      return next(createError('subject is required', 400));
    if (!description?.trim())
      return next(createError('description is required', 400));

    // ── 2. Identify Customer ────────────────────────────────────────────────
    const jwtCustomer = {
      name: req.user?.name || req.user?.fullName || '',
      email: req.user?.email || '',
    };

    const mergedCustomer = mergeCustomerDetails(jwtCustomer, customerPayload || {});
    const customerValidation = validateCustomerDetails(mergedCustomer);

    if (!customerValidation.valid) {
      const firstError = Object.values(customerValidation.errors)[0];
      return next(createError(firstError, 400));
    }

    const customerId = req.user?.customerId;
    let customer = customerId ? await Customer.findById(customerId) : null;

    if (!customer) {
      customer = await Customer.findOne({ email: customerValidation.value.email.toLowerCase() });
    }

    if (!customer) {
      customer = await Customer.create({
        customer_id: `CUS-${Date.now().toString(36).toUpperCase()}`,
        name: customerValidation.value.name,
        email: customerValidation.value.email,
        password: 'guest-ticket',
      });
    } else {
      const shouldUpdate = customer.name !== customerValidation.value.name || customer.email !== customerValidation.value.email;
      if (shouldUpdate) {
        customer.name = customerValidation.value.name;
        customer.email = customerValidation.value.email;
        await customer.save();
      }
    }

    // ── 3. Gemini Classification ──────────────────────────────────────────────
    console.log(`\n[Customer Input]\nCategory: ${userCategory || 'None'}\nPriority: ${userPriority || 'None'}\n`);
    
    const classification = await classifyTicket({ 
      subject, 
      description, 
      userCategory, 
      userPriority 
    });

    const finalCategory = classification.category;
    const finalPriority = classification.priority;
    const validationSource = classification.validationSource;
    const confidence = classification.confidence;

    console.log(`[Gemini Prediction]\nCategory: ${finalCategory}\nPriority: ${finalPriority}\n`);

    // ── 4. Create base Ticket document ────────────────────────────────────
    let ticketId;
    let isUnique = false;
    for (let attempt = 0; attempt < 5 && !isUnique; attempt++) {
      ticketId = generateTicketId();
      isUnique = !(await Ticket.exists({ ticketId }));
    }
    if (!isUnique) return next(createError('Could not generate unique ticket ID', 500));

    const ticket = new Ticket({
      ticketId,
      external_ref: external_ref || null,
      customer: customer._id,
      subject: subject.trim(),
      description: description.trim(),
      category: finalCategory,
      priority: finalPriority,
      channel: channel || 'web',
      status: 'New',
      metadata: {
        app_version: metadata?.app_version || null,
        platform: metadata?.platform || null,
      },
      tags: Array.isArray(tags) ? tags : [],
      predictedCategory: finalCategory,
      predictedPriority: finalPriority,
      aiCategory: finalCategory,
      aiPriority: finalPriority,
      validationSource: validationSource,
      aiConfidence: confidence
    });
    
    ticket.requiredLevel = getRequiredSupportLevel(ticket.priority);
    const slaPriority = getSlaPriority(ticket.priority);
    ticket.priority = slaPriority;
    
    // Save the finalized ticket to MongoDB
    await ticket.save();

    console.log(`[Saved Ticket]\nCategory: ${ticket.category}\nPriority: ${ticket.priority}\n`);

    await AuditLog.create({
      ticket: ticket._id,
      ticketId: ticket.ticketId,
      eventType: 'ticket_created',
      details: { subject, category: ticket.category, priority: ticket.priority },
      performedBy: 'system',
    });

    // ── 5. Assignment Engine ──────────────────────────────────────────────
    console.log(`[Assignment]\nUsing AI prediction`);

    const assignment = await findAndAssign(finalPriority, ticketId, {
      category: finalCategory,
    });
    const now = new Date();

    if (assignment) {
      // ── Assigned ───────────────────────────────────────────────────────
      ticket.assignedAgent = assignment.agent._id;
      ticket.assignedEngineer = assignment.agent._id;
      ticket.assignedLevel = assignment.assignedLevel;
      ticket.requiredLevel = assignment.requiredLevel || ticket.requiredLevel;
      ticket.assignmentReason = assignment.assignmentReason;
      ticket.assignmentTimestamp = now;
      ticket.status = 'Assigned';

      // Set SLA deadline from assignment time
      const slaHours = cfg.SLA_HOURS[slaPriority] ?? 24;
      ticket.slaDeadline = new Date(now.getTime() + slaHours * 60 * 60 * 1000);

      await ticket.save();

      // Update customer stats
      await Customer.findByIdAndUpdate(customer._id, {
        $inc: { totalTickets: 1 },
        $set: { lastTicketAt: now },
      });

      await AuditLog.create({
        ticket: ticket._id,
        ticketId: ticket.ticketId,
        eventType: 'agent_assigned',
        details: {
          agentId: assignment.agent.agent_id,
          agentName: assignment.agent.name,
          assignedLevel: assignment.assignedLevel,
          requiredLevel: assignment.requiredLevel,
          assignmentReason: assignment.assignmentReason,
          priority: ticket.priority,
        },
        performedBy: 'assignment_engine',
      });


      // Trigger notifications asynchronously
      try {
        const { notifyTicketCreated, notifyTicketAssigned } = require('../services/notificationService');
        notifyTicketCreated(ticket, customer).catch(err => console.error('Failed to send creation email:', err.message));
        notifyTicketAssigned(ticket, customer, assignment.agent).catch(err => logError(`Failed to send assignment email: ${err.message}`));
      } catch (notifErr) {
        console.error('Notification error:', notifErr.message);
      }

      return res.status(201).json({
        status: 'accepted',
        ticket_id: ticketId,
        resolved_priority: finalPriority,
        resolved_category: finalCategory,
        assigned_level: assignment.assignedLevel,
        assigned_agent_id: assignment.agent.agent_id,
        validation_source: validationSource,
        confidence_score: confidence,
        message: 'Ticket received and assigned successfully.',
      });
    } else {
      // ── No agent available — queue ─────────────────────────────────────
      ticket.requiredLevel = getRequiredSupportLevel(finalPriority);
      await ticket.save(); // save first so we have _id for audit log

      await Customer.findByIdAndUpdate(customer._id, {
        $inc: { totalTickets: 1 },
        $set: { lastTicketAt: now },
      });

      await enqueue(ticket, slaPriority); // sets isQueued, queuedAt, slaDeadline

      logAssignmentFailed(ticketId, 'No eligible agent available');

      // Trigger creation notification asynchronously
      try {
        const { notifyTicketCreated } = require('../services/notificationService');
        notifyTicketCreated(ticket, customer).catch(err => console.error('Failed to send creation email:', err.message));
      } catch (notifErr) {
        console.error('Notification error:', notifErr.message);
      }

      return res.status(202).json({
        status: 'accepted',
        ticket_id: ticketId,
        resolved_priority: finalPriority,
        resolved_category: finalCategory,
        assigned_level: null,
        assigned_agent_id: null,
        validation_source: validationSource,
        confidence_score: confidence,
        message: 'Ticket received and queued. Will be assigned when an agent becomes available.',
      });
    }
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((e) => e.message).join(', ');
      return next(createError(messages, 422));
    }
    next(err);
  }
});

// ── GET /api/tickets — List tickets with filtering ───────────────────────────

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { email, status, category, priority, isQueued, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (isQueued !== undefined) filter.isQueued = isQueued === 'true';

    // ── Role-Based Access Control Filtering ──
    if (req.user.role === 'customer') {
      filter.customer = req.user.customerId;
    } else if (req.user.role === 'engineer') {
      filter.assignedAgent = req.user.supportAgentId;
    }
    // admin gets all

    // Additional query filters (for admin/engineer if they provide email)
    if (email && req.user.role !== 'customer') {
      const customer = await Customer.findOne({ email: email.toLowerCase() });
      if (customer) filter.customer = customer._id;
      else return res.json({ success: true, data: [], pagination: { total: 0, page: 1, limit: Number(limit), pages: 0 } });
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [tickets, total] = await Promise.all([
      Ticket.find(filter)
        .populate('customer', 'name email customer_id')
        .populate('assignedAgent', 'name agent_id level')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Ticket.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: tickets,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/tickets/:id — Single ticket with full detail ─────────────────────

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const isMongoId = /^[a-f\d]{24}$/i.test(id);

    const ticket = await Ticket.findOne(
      isMongoId ? { $or: [{ ticketId: id }, { _id: id }] } : { ticketId: id }
    )
      .populate('customer', 'name email customer_id preferredChannel')
      .populate('assignedAgent', 'name email agent_id level department');

    if (!ticket) return next(createError('Ticket not found', 404));

    // Role-based verification
    if (req.user.role === 'customer' && ticket.customer._id.toString() !== req.user.customerId?.toString()) {
      return next(createError('Forbidden', 403));
    }
    if (req.user.role === 'engineer' && ticket.assignedAgent?._id.toString() !== req.user.supportAgentId?.toString()) {
      return next(createError('Forbidden', 403));
    }

    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/tickets/:id/audit — Full audit trail ─────────────────────────────

router.get('/:id/audit', authenticate, async (req, res, next) => {
  try {
    const logs = await AuditLog.find({ ticketId: req.params.id }).sort({ createdAt: 1 });
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/tickets/:id/status — Manual status update ─────────────────────

router.patch('/:id/status', authenticate, async (req, res, next) => {
  try {
    const { status, by = 'agent' } = req.body;
    if (!status) return next(createError('status is required', 400));

    const allowed = ['New', 'Assigned', 'In Progress', 'Resolved', 'Closed'];
    if (!allowed.includes(status)) return next(createError(`status must be one of: ${allowed.join(', ')}`, 400));

    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return next(createError('Ticket not found', 404));

    const prevStatus = ticket.status;
    if (prevStatus === status) {
      return res.json({ success: true, message: `Status is already "${status}"`, data: ticket });
    }

    ticket.status = status;
    if (status === 'Resolved') ticket.resolvedAt = new Date();
    if (status === 'Closed') ticket.closedAt = new Date();
    await ticket.save();

    // Decrement active_tickets when a ticket is Resolved or Closed
    const isResolvedOrClosed = ['Resolved', 'Closed'].includes(status);
    const wasResolvedOrClosed = ['Resolved', 'Closed'].includes(prevStatus);

    if (isResolvedOrClosed && !wasResolvedOrClosed && ticket.assignedAgent) {
      try {
        const { releaseTicket } = require('../services/assignmentEngine');
        await releaseTicket(ticket.assignedAgent);

        // After capacity is freed, immediately drain the queue for this specific agent.
        // This ensures L3 engineers pick up High-priority queued tickets first,
        // L2 engineers pick up Medium tickets first, and L1 picks up Low tickets.
        const { drainQueueForAgent } = require('../services/queueDrainer');
        drainQueueForAgent(ticket.assignedAgent).catch(err =>
          console.error('[QueueDrain Error]', err.message)
        );
      } catch (releaseErr) {
        console.error('[Capacity Free Error]', releaseErr.message);
      }
    }

    // Trigger status change notifications asynchronously
    try {
      const customer = await Customer.findById(ticket.customer);
      if (customer) {
        const { notifyStatusChanged } = require('../services/notificationService');
        notifyStatusChanged(ticket, customer, prevStatus, status).catch(err =>
          console.error('Failed to create status notification:', err.message)
        );
      }
    } catch (notifErr) {
      console.error('Status notification error:', notifErr.message);
    }

    await AuditLog.create({
      ticket: ticket._id,
      ticketId: ticket.ticketId,
      eventType: 'status_changed',
      details: { from: prevStatus, to: status },
      performedBy: by,
    });

    res.json({ success: true, message: `Status updated to "${status}"`, data: ticket });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/tickets/:id/notes — Add an internal note ───────────────────────

router.post('/:id/notes', authenticate, async (req, res, next) => {
  try {
    const { body, author = 'System' } = req.body;
    if (!body?.trim()) return next(createError('body is required', 400));

    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return next(createError('Ticket not found', 404));

    ticket.notes.push({ body: body.trim(), author });
    await ticket.save();

    res.status(201).json({ success: true, data: ticket.notes[ticket.notes.length - 1] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
