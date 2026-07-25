const mongoose = require('mongoose');

const SupportAgentSchema = new mongoose.Schema(
  {
    agent_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    level: {
      type: String,
      required: true,
      enum: ['L1', 'L2', 'L3'],
      default: 'L1',
    },
    status: {
      type: String,
      enum: ['available', 'busy', 'offline'],
      default: 'offline',
    },
    active_tickets: {
      type: Number,
      default: 0,
      min: 0,
    },
    max_capacity: {
      type: Number,
      required: true,
      min: 1,
    },
    skills: {
      type: [String],
      default: [],
    },
    department: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastAssignedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes (removed agent_id and email since they are unique at field level)
SupportAgentSchema.index({ status: 1 });

module.exports = mongoose.model('SupportAgent', SupportAgentSchema);
