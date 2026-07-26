const jwt = require('jsonwebtoken');
const { createError } = require('./errorHandler');

// JWT Secret (should be in env vars, default for dev)
const JWT_SECRET = process.env.JWT_SECRET || 'swiftdesk-super-secret-key';

/**
 * Middleware to verify JWT token and attach user payload to req.user
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = {};
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { userId, role, engineerLevel, supportAgentId, customerId, name, email }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(createError('Token expired. Please log in again.', 401));
    }
    return next(createError('Invalid token.', 401));
  }
};

const requireCustomer = (req, res, next) => {
  if (!req.user || req.user.role !== 'customer') {
    return next(createError('Forbidden: Requires customer role', 403));
  }
  next();
};

const requireEngineer = (req, res, next) => {
  if (!req.user || req.user.role !== 'engineer') {
    return next(createError('Forbidden: Requires engineer role', 403));
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(createError('Forbidden: Requires admin role', 403));
  }
  next();
};

module.exports = {
  authenticate,
  requireCustomer,
  requireEngineer,
  requireAdmin,
  JWT_SECRET,
};
