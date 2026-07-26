const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { createError } = require('../middleware/errorHandler');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Generate stable customer ID for new customers
function generateCustomerId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `CUS-${id}`;
}

/**
 * @route   POST /api/auth/register
 * @desc    Register a new customer
 * @access  Public
 */
router.post('/register', async (req, res, next) => {
  try {
    // Keep backward compatible input (full_name) or allow fullName
    const fullName = req.body.fullName || req.body.full_name;
    const { email, password } = req.body;

    if (!fullName || !email || !password) {
      return next(createError('Full name, email, and password are required', 400));
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return next(createError('User with this email already exists', 400));
    }

    // Create the Identity User
    const user = new User({
      fullName,
      email: email.toLowerCase(),
      password: password, // pre-save hook handles hashing
      role: 'customer',
      engineerLevel: null,
    });

    // Check if a Customer document already exists from past tickets
    let customerDoc = await Customer.findOne({ email: user.email });
    if (!customerDoc) {
      customerDoc = await Customer.create({
        customer_id: generateCustomerId(),
        name: fullName,
        email: user.email,
        password: password,
        totalTickets: 0,
      });
    }

    // Link them
    user.customer = customerDoc._id;
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        customerId: user.customer,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and get JWT
 * @access  Public
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(createError('Email and password are required', 400));
    }

    // Find user by email — must explicitly select password since select:false
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return next(createError('Invalid credentials', 401));
    }

    if (!user.isActive) {
      return next(createError('Account is deactivated', 403));
    }

    if (!user.password) {
      return next(createError('Invalid credentials', 401));
    }

    // Compare passwords
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return next(createError('Invalid credentials', 401));
    }

    // Create JWT Payload
    const payload = {
      userId: user._id,
      role: user.role,
      engineerLevel: user.engineerLevel,
      supportAgentId: user.supportAgent,
      customerId: user.customer,
      name: user.fullName,
      email: user.email,
    };

    // Sign Token (expires in 24 hours)
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.fullName,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        engineerLevel: user.engineerLevel,
        supportAgentId: user.supportAgent ? user.supportAgent.toString() : null,
        customerId: user.customer ? user.customer.toString() : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
