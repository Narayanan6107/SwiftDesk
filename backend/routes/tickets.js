const express = require('express');
const router = express.Router();
const Ticket = require('../models/Ticket');
const { createError } = require('../middleware/errorHandler');

// ── POST /api/tickets — Create a new ticket ──────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { subject, description, category, priority, customer } = req.body;

    // Basic validation
    if (!subject || !description || !category || !customer?.name || !customer?.email) {
      return next(createError('subject, description, category, customer.name and customer.email are required', 400));
    }

    const ticket = new Ticket({ subject, description, category, priority, customer });
    await ticket.save();

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: ticket,
    });
  } catch (err) {
    // Mongoose validation errors
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((e) => e.message).join(', ');
      return next(createError(messages, 422));
    }
    next(err);
  }
});

// ── GET /api/tickets — Get all tickets (optionally filter by email) ──────────
router.get('/', async (req, res, next) => {
  try {
    const { email, status, category, priority, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (email) filter['customer.email'] = email.toLowerCase();
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;

    const skip = (Number(page) - 1) * Number(limit);
    const [tickets, total] = await Promise.all([
      Ticket.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).select('-activity'),
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

// ── GET /api/tickets/:id — Get a single ticket by ticketId or _id ─────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Support both MongoDB _id and friendly ticketId (e.g. SD-10001)
    const ticket = await Ticket.findOne({
      $or: [{ ticketId: id }, { _id: id.match(/^[a-f\d]{24}$/i) ? id : undefined }],
    });

    if (!ticket) return next(createError('Ticket not found', 404));

    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/tickets/:id/status — Update ticket status ─────────────────────
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, by = 'System' } = req.body;

    if (!status) return next(createError('status is required', 400));

    const ticket = await Ticket.findOne({ $or: [{ ticketId: id }, { _id: id }] });
    if (!ticket) return next(createError('Ticket not found', 404));

    ticket.transitionStatus(status, by); // throws on invalid transition
    await ticket.save();

    res.json({
      success: true,
      message: `Ticket status updated to "${status}"`,
      data: ticket,
    });
  } catch (err) {
    if (err.statusCode === 400) return next(err);
    next(err);
  }
});

// ── PATCH /api/tickets/:id/assign — Assign ticket to agent ───────────────────
router.patch('/:id/assign', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignedTo, by = 'System' } = req.body;

    if (!assignedTo) return next(createError('assignedTo is required', 400));

    const ticket = await Ticket.findOne({ $or: [{ ticketId: id }, { _id: id }] });
    if (!ticket) return next(createError('Ticket not found', 404));

    ticket.assignedTo = assignedTo;
    ticket.activity.push({
      type: 'assigned',
      message: `Ticket assigned to ${assignedTo}`,
      by,
    });

    // Auto-transition to Assigned if still New
    if (ticket.status === 'New') {
      ticket.status = 'Assigned';
      ticket.activity.push({
        type: 'status_changed',
        message: `Status changed from "New" to "Assigned"`,
        by,
        fromStatus: 'New',
        toStatus: 'Assigned',
      });
    }

    await ticket.save();
    res.json({ success: true, message: 'Ticket assigned', data: ticket });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/tickets/:id/activity — Add a comment/note to activity log ───────
router.post('/:id/activity', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type = 'comment', message, by = 'System' } = req.body;

    if (!message) return next(createError('message is required', 400));

    const ticket = await Ticket.findOne({ $or: [{ ticketId: id }, { _id: id }] });
    if (!ticket) return next(createError('Ticket not found', 404));

    ticket.activity.push({ type, message, by });
    await ticket.save();

    res.status(201).json({
      success: true,
      message: 'Activity added',
      data: ticket.activity[ticket.activity.length - 1],
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/tickets/:id — Soft-close a ticket ─────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const ticket = await Ticket.findOne({ $or: [{ ticketId: id }, { _id: id }] });
    if (!ticket) return next(createError('Ticket not found', 404));

    if (ticket.status !== 'Closed') {
      ticket.transitionStatus('Closed', 'Customer');
      await ticket.save();
    }

    res.json({ success: true, message: 'Ticket closed', data: { ticketId: ticket.ticketId } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
