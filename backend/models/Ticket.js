const mongoose = require('mongoose');

const NoteSchema = new mongoose.Schema(
  {
    body: {
      type: String,
      required: true,
      trim: true,
    },
    author: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

const AttachmentSchema = new mongoose.Schema(
  {
    filename: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'uploadedAt', updatedAt: false },
  }
);

const TicketSchema = new mongoose.Schema(
  {
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
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: ['Technical', 'Billing', 'General', 'Account', 'Feature Request'],
    },
    priority: {
      type: String,
      required: true,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium',
    },
    channel: {
      type: String,
      enum: ['email', 'web', 'chat', 'phone'],
      default: 'web',
    },
    metadata: {
      app_version: {
        type: String,
        trim: true,
        default: null,
      },
      platform: {
        type: String,
        trim: true,
        default: null,
      },
    },
    assignedAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportAgent',
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: ['Open', 'Assigned', 'In Progress', 'Resolved', 'Closed'],
      default: 'Open',
    },
    aiCategory: {
      type: String,
      trim: true,
      default: null,
    },
    aiPriority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical', null],
      default: null,
    },
    aiConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },
    aiSummary: {
      type: String,
      trim: true,
      default: null,
    },
    sentiment: {
      type: String,
      trim: true,
      default: null,
    },
    duplicateOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      default: null,
    },
    resolution: {
      type: String,
      trim: true,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
    notes: {
      type: [NoteSchema],
      default: [],
    },
    attachments: {
      type: [AttachmentSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
TicketSchema.index({ ticketId: 1 });
TicketSchema.index({ external_ref: 1 });
TicketSchema.index({ customer: 1 });
TicketSchema.index({ assignedAgent: 1 });
TicketSchema.index({ status: 1 });
TicketSchema.index({ priority: 1 });
TicketSchema.index({ category: 1 });
TicketSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Ticket', TicketSchema);
