const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema(
  {
    customer_id: {
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
    totalTickets: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastTicketAt: {
      type: Date,
      default: null,
    },
    preferredChannel: {
      type: String,
      enum: ['email', 'web', 'chat', 'phone'],
      default: 'web',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
CustomerSchema.index({ customer_id: 1 });
CustomerSchema.index({ email: 1 });

module.exports = mongoose.model('Customer', CustomerSchema);
