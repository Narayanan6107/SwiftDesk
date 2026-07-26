const mongoose = require('mongoose');

// ── Embedded sub-schemas ──────────────────────────────────────────────────────

const NoteSchema = new mongoose.Schema(
  {
    body: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

const AttachmentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: 'uploadedAt', updatedAt: false } }
);

/** Records every time a ticket is moved to a higher support level. */
const EscalationEntrySchema = new mongoose.Schema(
  {
    fromLevel: { type: String, enum: ['L1', 'L2', 'L3'] },
    toLevel: { type: String, enum: ['L1', 'L2', 'L3'] },
    reason: { type: String, default: 'SLA breached' },
    newAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportAgent', default: null },
  },
  { timestamps: { createdAt: 'escalatedAt', updatedAt: false } }
);

// ── Main Ticket Schema ────────────────────────────────────────────────────────

const TicketSchema = new mongoose.Schema(
  {
    // ── Identifiers ───────────────────────────────────────────────────────
    ticketId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    external_ref: {
      type: String,
      trim: true,
      default: null,
    },

    // ── Core ticket data ──────────────────────────────────────────────────
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 300,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
    },
    /** User-supplied category (may be overridden by AI classification). */
    category: {
      type: String,
      required: true,
      enum: ['Billing', 'Technical', 'Account', 'Delivery', 'Other'],
    },
    /** User-supplied priority (may be overridden by AI classification). */
    priority: {
      type: String,
      required: true,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium',
    },
    channel: {
      type: String,
      enum: ['email', 'web', 'web_app', 'chat', 'phone'],
      default: 'web',
    },
    /** Embedded metadata — no separate collection needed. */
    metadata: {
      app_version: { type: String, trim: true, default: null },
      platform: { type: String, trim: true, default: null },
    },

    // ── Lifecycle ────────────────────────────────────────────────────────
    status: {
      type: String,
      required: true,
      enum: ['New', 'Assigned', 'In Progress', 'Resolved', 'Closed'],
      default: 'New',
    },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    // ── AI Classification ─────────────────────────────────────────────────
    /** Whether the final category/priority came from ML or LLM. */
    validationSource: {
      type: String,
      enum: ['ML', 'LLM', 'Gemini', null],
      default: null,
    },
    /** Raw ML model output. */
    mlPrediction: {
      category: { type: String, default: null },
      priority: { type: String, default: null },
      confidence: { type: Number, min: 0, max: 1, default: null },
    },
    /** LLM explanation (only populated when LLM was invoked). */
    llmExplanation: { type: String, trim: true, default: null },
    /** AI-resolved category (what the system actually uses). */
    aiCategory: { type: String, trim: true, default: null },
    /** AI-resolved priority (what the system actually uses). */
    aiPriority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical', null],
      default: null,
    },
    /** ML-predicted priority before assignment (may include Critical). */
    predictedPriority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical', null],
      default: null,
    },
    /** ML-predicted category used for skill matching. */
    predictedCategory: { type: String, trim: true, default: null },
    /** Minimum engineer tier required for this ticket (preserved when queued). */
    requiredLevel: {
      type: String,
      enum: ['L1', 'L2', 'L3', null],
      default: null,
    },
    assignmentReason: { type: String, trim: true, default: null },
    aiConfidence: { type: Number, min: 0, max: 1, default: null },
    aiSummary: { type: String, trim: true, default: null },
    sentiment: {
      type: String,
      enum: ['positive', 'neutral', 'negative', 'frustrated', null],
      default: null,
    },
    /**
     * Agent-confirmed final classification — used as ML training data.
     * Set by the support agent when closing/resolving a ticket.
     * The Python ML service queries tickets where these fields are non-null.
     */
    finalCategory: {
      type: String,
      enum: ['Technical', 'Billing', 'General', 'Account', 'Feature Request', 'Delivery', 'Other', null],
      default: null,
    },
    finalPriority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical', null],
      default: null,
    },

    // ── Assignment ────────────────────────────────────────────────────────
    assignedAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportAgent',
      default: null,
    },
    assignedEngineer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportAgent',
      default: null,
    },
    /** Support tier the ticket was assigned to. */
    assignedLevel: {
      type: String,
      enum: ['L1', 'L2', 'L3', null],
      default: null,
    },
    assignmentTimestamp: { type: Date, default: null },

    // ── Queue & SLA ───────────────────────────────────────────────────────
    /** True while no eligible agent is available. */
    isQueued: { type: Boolean, default: false },
    queuedAt: { type: Date, default: null },
    /** Absolute deadline computed from priority × SLA config at creation time. */
    slaDeadline: { type: Date, default: null },
    slaBreached: { type: Boolean, default: false },

    // ── Escalation history ────────────────────────────────────────────────
    escalationHistory: { type: [EscalationEntrySchema], default: [] },

    // ── Extras ────────────────────────────────────────────────────────────
    duplicateOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      default: null,
    },
    resolution: { type: String, trim: true, default: null },
    tags: { type: [String], default: [] },
    notes: { type: [NoteSchema], default: [] },
    attachments: { type: [AttachmentSchema], default: [] },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
TicketSchema.index({ external_ref: 1 });
TicketSchema.index({ customer: 1 });
TicketSchema.index({ assignedAgent: 1 });
TicketSchema.index({ status: 1 });
TicketSchema.index({ priority: 1 });
TicketSchema.index({ category: 1 });
TicketSchema.index({ createdAt: -1 });
TicketSchema.index({ isQueued: 1, queuedAt: 1 });   // queue processor
TicketSchema.index({ slaDeadline: 1, slaBreached: 1 }); // SLA watcher
TicketSchema.index({ finalCategory: 1, finalPriority: 1 }); // ML training queries

module.exports = mongoose.model('Ticket', TicketSchema);
