const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Ticket = require('../models/Ticket');
const Customer = require('../models/Customer');
const AuditLog = require('../models/AuditLog');
const { createError } = require('../middleware/errorHandler');
const { classify } = require('../services/mlClassifier');
const { validate: llmValidate } = require('../services/llmValidator');
const { findAndAssign } = require('../services/assignmentEngine');
const { enqueue } = require('../services/queueManager');
const { authenticate } = require('../middleware/auth');
const cfg = require('../config/automation');

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
    if (!customerPayload?.name?.trim() || !customerPayload?.email?.trim())
      return next(createError('customer.name and customer.email are required', 400));
    if (!/^\S+@\S+\.\S+$/.test(customerPayload.email))
      return next(createError('customer.email is not a valid email address', 400));

    // ── 2. Identify Customer ────────────────────────────────────────────────
    // customer_id now comes from the authenticated JWT instead of the request body
    const customerId = req.user.customerId;
    if (!customerId) return next(createError('User is not linked to a customer account', 400));
    
    let customer = await Customer.findById(customerId);
    if (!customer) return next(createError('Customer not found', 404));

    // ── 3. Create base Ticket document ────────────────────────────────────
    // We generate ticketId here; we guarantee uniqueness with a retry loop.
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
      // Use user-provided category/priority as fallback; AI will override below
      category: userCategory || 'General',
      priority: userPriority || 'Medium',
      channel: channel || 'web',
      metadata: {
        app_version: metadata?.app_version || null,
        platform: metadata?.platform || null,
      },
      tags: Array.isArray(tags) ? tags : [],
    });

    // ── 4. ML Classification ──────────────────────────────────────────────
    const mlResult = await classify(subject, description);

    ticket.mlPrediction = {
      category: mlResult.category,
      priority: mlResult.priority,
      confidence: mlResult.confidence,
    };
    ticket.aiConfidence = mlResult.confidence;
    ticket.sentiment = mlResult.sentiment || null;

    let resolvedCategory, resolvedPriority, validationSource, llmExplanation;

    if (mlResult.confidence >= cfg.ML_CONFIDENCE_THRESHOLD) {
      // ── 5a. Trust ML prediction ────────────────────────────────────────
      resolvedCategory = mlResult.category;
      resolvedPriority = mlResult.priority;
      validationSource = 'ML';
      llmExplanation = null;

      await AuditLog.create({
        ticket: ticket._id,
        ticketId: ticket.ticketId,
        eventType: 'ml_classified',
        details: {
          category: resolvedCategory,
          priority: resolvedPriority,
          confidence: mlResult.confidence,
          threshold: cfg.ML_CONFIDENCE_THRESHOLD,
        },
        performedBy: 'ml_classifier',
      });

      console.log(
        `[ML] Ticket ${ticketId} classified — ${resolvedCategory} / ${resolvedPriority} (confidence: ${(mlResult.confidence * 100).toFixed(1)}%)`
      );
    } else {
      // ── 5b. Low confidence → invoke LLM ───────────────────────────────
      console.log(
        `[ML] Low confidence (${(mlResult.confidence * 100).toFixed(1)}%) for ${ticketId} — invoking LLM`
      );
      const llmResult = await llmValidate(subject, description, mlResult);

      resolvedCategory = llmResult.category;
      resolvedPriority = llmResult.priority;
      validationSource = 'LLM';
      llmExplanation = llmResult.explanation;

      await AuditLog.create({
        ticket: ticket._id,
        ticketId: ticket.ticketId,
        eventType: 'llm_validated',
        details: {
          category: resolvedCategory,
          priority: resolvedPriority,
          explanation: llmExplanation,
          mlConfidence: mlResult.confidence,
          usedLLMApi: llmResult.usedLLM,
        },
        performedBy: 'llm_validator',
      });
    }

    // Apply resolved classification back to ticket
    ticket.category = resolvedCategory;
    ticket.priority = resolvedPriority;
    ticket.aiCategory = resolvedCategory;
    ticket.aiPriority = resolvedPriority;
    ticket.validationSource = validationSource;
    ticket.llmExplanation = llmExplanation;

    // ── 6. Assignment Engine ──────────────────────────────────────────────
    const assignment = await findAndAssign(resolvedPriority);
    const now = new Date();

    if (assignment) {
      // ── Assigned ───────────────────────────────────────────────────────
      ticket.assignedAgent = assignment.agent._id;
      ticket.assignedLevel = assignment.assignedLevel;
      ticket.assignmentTimestamp = now;
      ticket.status = 'Assigned';

      // Set SLA deadline from assignment time
      const slaHours = cfg.SLA_HOURS[resolvedPriority] ?? 24;
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
          priority: resolvedPriority,
        },
        performedBy: 'assignment_engine',
      });

      await AuditLog.create({
        ticket: ticket._id,
        ticketId: ticket.ticketId,
        eventType: 'ticket_created',
        details: { subject, category: resolvedCategory, priority: resolvedPriority },
        performedBy: 'system',
      });

      console.log(
        `[Assign] Ticket ${ticketId} → ${assignment.agent.name} (${assignment.assignedLevel})`
      );

      // Trigger notifications asynchronously
      try {
        const { notifyTicketCreated, notifyTicketAssigned } = require('../services/notificationService');
        notifyTicketCreated(ticket, customer).catch(err => console.error('Failed to send creation email:', err.message));
        notifyTicketAssigned(ticket, customer, assignment.agent).catch(err => console.error('Failed to send assignment email:', err.message));
      } catch (notifErr) {
        console.error('Notification error:', notifErr.message);
      }

      return res.status(201).json({
        status: 'accepted',
        ticket_id: ticketId,
        resolved_priority: resolvedPriority,
        resolved_category: resolvedCategory,
        assigned_level: assignment.assignedLevel,
        assigned_agent_id: assignment.agent.agent_id,
        validation_source: validationSource,
        confidence_score: mlResult.confidence,
        message: 'Ticket received and assigned successfully.',
      });
    } else {
      // ── No agent available — queue ─────────────────────────────────────
      await ticket.save(); // save first so we have _id for audit log

      await Customer.findByIdAndUpdate(customer._id, {
        $inc: { totalTickets: 1 },
        $set: { lastTicketAt: now },
      });

      await enqueue(ticket, resolvedPriority); // sets isQueued, queuedAt, slaDeadline

      await AuditLog.create({
        ticket: ticket._id,
        ticketId: ticket.ticketId,
        eventType: 'ticket_created',
        details: { subject, category: resolvedCategory, priority: resolvedPriority },
        performedBy: 'system',
      });

      console.log(`[Assign] Ticket ${ticketId} queued (no eligible agent available)`);

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
        resolved_priority: resolvedPriority,
        resolved_category: resolvedCategory,
        assigned_level: null,
        assigned_agent_id: null,
        validation_source: validationSource,
        confidence_score: mlResult.confidence,
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

    const allowed = ['Open', 'Assigned', 'In Progress', 'Resolved', 'Closed'];
    if (!allowed.includes(status)) return next(createError(`status must be one of: ${allowed.join(', ')}`, 400));

    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return next(createError('Ticket not found', 404));

    const prevStatus = ticket.status;
    ticket.status = status;
    if (status === 'Resolved') ticket.resolvedAt = new Date();
    if (status === 'Closed') ticket.closedAt = new Date();
    await ticket.save();

    // Trigger status change notifications asynchronously
    try {
      const customer = await Customer.findById(ticket.customer);
      if (customer) {
        const { notifyTicketResolved, notifyTicketClosed } = require('../services/notificationService');
        if (status === 'Resolved') {
          notifyTicketResolved(ticket, customer).catch(err => console.error('Failed to send resolution email:', err.message));
        } else if (status === 'Closed') {
          notifyTicketClosed(ticket, customer).catch(err => console.error('Failed to send closure email:', err.message));
        }
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
