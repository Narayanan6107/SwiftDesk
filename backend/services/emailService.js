const nodemailer = require('nodemailer');
const NotificationLog = require('../models/notificationLog');

const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '25', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'SwiftDesk Support <noreply@swiftdesk.com>';
const EMAIL_MODE = process.env.EMAIL_MODE || 'mock'; // 'smtp' | 'mock'

// Configure Nodemailer transporter if mode is smtp
let transporter = null;
if (EMAIL_MODE === 'smtp') {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for other ports
    auth: SMTP_USER && SMTP_PASS ? {
      user: SMTP_USER,
      pass: SMTP_PASS,
    } : undefined,
  });
}

/**
 * Send an email using SMTP or Mock Mode.
 * Logs success or failure to the NotificationLog database collection.
 * 
 * @param {object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject line
 * @param {string} options.body - Email body text or HTML
 * @param {string} [options.ticketObjectId] - Ticket MongoDB ObjectId
 * @param {string} options.recipientRole - 'customer' | 'engineer' | 'admin'
 * @param {string} options.notificationType - Type identifier (e.g. 'ticket_created')
 */
async function sendEmail({ to, subject, body, ticketObjectId, recipientRole, notificationType }) {
  const deliveryMethod = EMAIL_MODE === 'smtp' ? 'email' : 'mock';
  
  try {
    if (EMAIL_MODE === 'smtp' && transporter) {
      await transporter.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        html: body,
      });
      console.log(`[Email] Email sent successfully to ${to} (SMTP)`);
    } else {
      console.log(`[Email Mock] Simulating email delivery to ${to}:`);
      console.log(`Subject: ${subject}`);
      console.log(`Body: ${body.substring(0, 300)}...`);
    }

    // Log success
    await NotificationLog.create({
      ticket: ticketObjectId || null,
      recipientEmail: to,
      recipientRole,
      notificationType,
      subject,
      body,
      deliveryMethod,
      status: 'success',
    });
    return { success: true };
  } catch (err) {
    console.error(`[Email Error] Failed to deliver email to ${to}:`, err.message);
    
    // Log failure
    try {
      await NotificationLog.create({
        ticket: ticketObjectId || null,
        recipientEmail: to,
        recipientRole,
        notificationType,
        subject,
        body,
        deliveryMethod,
        status: 'failed',
        errorMessage: err.message,
      });
    } catch (dbErr) {
      console.error('Failed to save notification log error to database:', dbErr.message);
    }
    
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendEmail,
};
