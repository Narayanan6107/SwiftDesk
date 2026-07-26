const express = require('express');
const router = express.Router();

const CustomerNotification = require('../models/CustomerNotification');
const { authenticate, requireCustomer } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');

// All routes require an authenticated customer session
router.use(authenticate, requireCustomer);

/**
 * @route   GET /api/notifications
 * @desc    Get the 10 most recent notifications for the logged-in customer.
 *          Full history is kept in the database; only the latest 10 are returned.
 * @access  Customer
 */
router.get('/', async (req, res, next) => {
  try {
    const customerId = req.user.customerId;
    if (!customerId) return next(createError('Customer ID not found in token', 400));

    const notifications = await CustomerNotification.find({ customer: customerId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({ success: true, data: notifications });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get the count of unread notifications for the logged-in customer.
 * @access  Customer
 */
router.get('/unread-count', async (req, res, next) => {
  try {
    const customerId = req.user.customerId;
    if (!customerId) return next(createError('Customer ID not found in token', 400));

    const count = await CustomerNotification.countDocuments({
      customer: customerId,
      isRead: false,
    });

    res.json({ success: true, unreadCount: count });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   PATCH /api/notifications/read-all
 * @desc    Mark ALL notifications as read for the logged-in customer.
 *          Must be defined before /:id/read to avoid route collision.
 * @access  Customer
 */
router.patch('/read-all', async (req, res, next) => {
  try {
    const customerId = req.user.customerId;
    if (!customerId) return next(createError('Customer ID not found in token', 400));

    const result = await CustomerNotification.updateMany(
      { customer: customerId, isRead: false },
      { $set: { isRead: true } }
    );

    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} notification(s) as read.`,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route   PATCH /api/notifications/:id/read
 * @desc    Mark a single notification as read.
 * @access  Customer
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const customerId = req.user.customerId;
    if (!customerId) return next(createError('Customer ID not found in token', 400));

    const notification = await CustomerNotification.findOneAndUpdate(
      { _id: req.params.id, customer: customerId }, // scoped to this customer for security
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notification) {
      return next(createError('Notification not found', 404));
    }

    res.json({ success: true, data: notification });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
