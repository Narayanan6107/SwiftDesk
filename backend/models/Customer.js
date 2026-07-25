const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

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
    password: {
      type: String,
      required: true,
      select: false,
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

// (Indexes for unique fields removed since they are declared on the field level)

CustomerSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model('Customer', CustomerSchema);
