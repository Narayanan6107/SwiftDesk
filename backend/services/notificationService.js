const { sendEmail } = require('./emailService');
const Customer = require('../models/Customer');
const SupportAgent = require('../models/SupportAgent');
const CustomerNotification = require('../models/CustomerNotification');

// ── HTML email template helper (used for engineer/admin emails only) ───────────

function getHtmlTemplate(title, preheader, content) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #334155; margin: 0; padding: 0; }
          .wrapper { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.02); }
          .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 32px; text-align: center; }
          .header h1 { color: #ffffff; font-size: 24px; font-weight: 800; margin: 0; letter-spacing: -0.025em; }
          .header p { color: #c7d2fe; font-size: 14px; margin: 8px 0 0 0; }
          .content { padding: 32px; line-height: 1.6; font-size: 15px; }
          .ticket-details { background-color: #f1f5f9; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #e2e8f0; }
          .ticket-details table { width: 100%; border-collapse: collapse; }
          .ticket-details td { padding: 6px 0; font-size: 14px; }
          .ticket-details td.label { font-weight: 600; color: #475569; width: 120px; }
          .ticket-details td.value { color: #0f172a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
          .footer { background-color: #f8fafc; padding: 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="header">
            <h1>SwiftDesk Support</h1>
            <p>${preheader}</p>
          </div>
          <div class="content">
            ${content}
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} SwiftDesk. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

// ── In-app notification writer ────────────────────────────────────────────────

/**
 * Persist an in-app notification for a customer.
 * This replaces all customer-facing email sends.
 *
 * @param {object} customer - Customer document (must have _id, name)
 * @param {object} ticket   - Ticket document (must have _id, ticketId)
 * @param {string} type     - Notification type enum value
 * @param {string} title    - Short heading
 * @param {string} message  - Full notification body
 */
async function createCustomerNotification(customer, ticket, type, title, message) {
  try {
    await CustomerNotification.create({
      customer: customer._id,
      ticket: ticket._id,
      ticketId: ticket.ticketId,
      type,
      title,
      message,
    });
    console.log(`[Notification] In-app notification created for customer ${customer._id} — type: ${type}`);
  } catch (err) {
    console.error(`[Notification] Failed to create in-app notification for customer ${customer._id}:`, err.message);
  }
}

// ── Customer in-app notification functions ────────────────────────────────────

/**
 * Notify customer when their ticket is created.
 * Replaces the customer email send entirely.
 */
async function notifyTicketCreated(ticket, customer) {
  await createCustomerNotification(
    customer,
    ticket,
    'ticket_created',
    '🎫 Ticket Created',
    `Your support ticket ${ticket.ticketId} — "${ticket.subject}" has been successfully received. ` +
    `Category: ${ticket.category} | Priority: ${ticket.priority}. ` +
    `We will assign an engineer shortly and keep you updated on its progress.`
  );
}

/**
 * Notify customer + engineer when a ticket is assigned.
 * Customer portion → in-app notification.
 * Engineer portion → email (unchanged).
 */
async function notifyTicketAssigned(ticket, customer, agent) {
  // ── In-app notification for customer ──────────────────────────────────────
  await createCustomerNotification(
    customer,
    ticket,
    'ticket_assigned',
    '👨‍💻 Ticket Assigned',
    `Your ticket ${ticket.ticketId} — "${ticket.subject}" has been assigned to an engineer ` +
    `and is now under active review. You will be notified as soon as there is an update.`
  );

  // ── Email notification for engineer (unchanged) ───────────────────────────
  const engineerSubject = `[SwiftDesk] New Ticket Assigned: ${ticket.ticketId}`;
  const engineerPreheader = 'You have a new support assignment.';
  const engineerContent = `
    <p>Hi ${agent.name},</p>
    <p>A new support ticket has been assigned to you. Please review and start investigation as soon as possible.</p>
    <div class="ticket-details">
      <table>
        <tr><td class="label">Ticket ID:</td><td class="value">${ticket.ticketId}</td></tr>
        <tr><td class="label">Subject:</td><td>${ticket.subject}</td></tr>
        <tr><td class="label">Customer Name:</td><td>${customer.name}</td></tr>
        <tr><td class="label">Customer Email:</td><td>${customer.email}</td></tr>
        <tr><td class="label">Priority:</td><td>${ticket.priority}</td></tr>
      </table>
    </div>
  `;

  await sendEmail({
    to: agent.email,
    subject: engineerSubject,
    body: getHtmlTemplate(engineerSubject, engineerPreheader, engineerContent),
    ticketObjectId: ticket._id,
    recipientRole: 'engineer',
    notificationType: 'ticket_assigned_engineer',
  });
}

/**
 * Notify customer when their ticket status changes.
 * All status transitions trigger an in-app notification.
 */
async function notifyStatusChanged(ticket, customer, prevStatus, newStatus) {
  let title = '';
  let message = '';

  switch (newStatus) {
    case 'In Progress':
      title = '🔄 Work Started';
      message = `An engineer has started working on your ticket ${ticket.ticketId} — "${ticket.subject}". ` +
        `We will notify you when it is resolved.`;
      break;
    case 'Resolved':
      title = '✅ Ticket Resolved';
      message = `Your ticket ${ticket.ticketId} — "${ticket.subject}" has been marked as resolved. ` +
        `${ticket.resolution ? `Resolution: ${ticket.resolution}. ` : ''}` +
        `If this doesn't fully solve your issue, please reach out and we'll reopen it.`;
      break;
    case 'Closed':
      title = '🔒 Ticket Closed';
      message = `Your ticket ${ticket.ticketId} — "${ticket.subject}" has been closed. ` +
        `Thank you for using SwiftDesk support. We hope your issue was resolved to your satisfaction.`;
      break;
    default:
      // Generic status change (Open, Assigned, etc.)
      title = '📋 Status Updated';
      message = `Your ticket ${ticket.ticketId} — "${ticket.subject}" has been updated ` +
        `from "${prevStatus}" to "${newStatus}".`;
  }

  await createCustomerNotification(customer, ticket, 'status_changed', title, message);
}

/**
 * Backward-compatible aliases so existing call sites in tickets.js still work.
 */
async function notifyTicketResolved(ticket, customer) {
  return notifyStatusChanged(ticket, customer, 'In Progress', 'Resolved');
}

async function notifyTicketClosed(ticket, customer) {
  return notifyStatusChanged(ticket, customer, 'Resolved', 'Closed');
}

/**
 * Notify customer + engineer + admin when a ticket is escalated.
 * Customer portion → in-app notification.
 * Engineer and admin portions → email (unchanged).
 */
async function notifyTicketEscalated(ticket, customer, nextLevelAgent, fromLevel, toLevel) {
  // ── In-app notification for customer ──────────────────────────────────────
  if (customer) {
    await createCustomerNotification(
      customer,
      ticket,
      'ticket_escalated',
      '🚨 Ticket Escalated',
      `Your ticket ${ticket.ticketId} — "${ticket.subject}" has been escalated to Tier ${toLevel} ` +
      `for faster resolution. ${nextLevelAgent ? `It has been assigned to a senior engineer.` : `An engineer at the next tier will be assigned shortly.`}`
    );
  }

  // ── Email notification for next-tier engineer (unchanged) ─────────────────
  if (nextLevelAgent) {
    const agentSubject = `[SwiftDesk] Escalated Assignment: ${ticket.ticketId}`;
    const agentContent = `
      <p>Hi ${nextLevelAgent.name},</p>
      <p>An escalated ticket has been assigned to you. This is an SLA breached ticket escalated from Tier ${fromLevel} to Tier ${toLevel}.</p>
      <div class="ticket-details">
        <table>
          <tr><td class="label">Ticket ID:</td><td class="value">${ticket.ticketId}</td></tr>
          <tr><td class="label">Subject:</td><td>${ticket.subject}</td></tr>
          <tr><td class="label">Priority:</td><td>${ticket.priority}</td></tr>
          <tr><td class="label">SLA Deadline:</td><td>${ticket.slaDeadline ? new Date(ticket.slaDeadline).toLocaleString() : 'N/A'}</td></tr>
        </table>
      </div>
    `;

    await sendEmail({
      to: nextLevelAgent.email,
      subject: agentSubject,
      body: getHtmlTemplate(agentSubject, 'You have been assigned an escalated support ticket.', agentContent),
      ticketObjectId: ticket._id,
      recipientRole: 'engineer',
      notificationType: 'ticket_escalated_engineer',
    });
  }

  // ── Email notification for admin (unchanged) ───────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@swiftdesk.com';
  const adminSubject = `[SwiftDesk Admin Alert] Ticket Escalated: ${ticket.ticketId}`;
  const adminContent = `
    <p>Hello Admin,</p>
    <p>A ticket has breached its SLA and has been escalated to Tier ${toLevel}.</p>
    <div class="ticket-details">
      <table>
        <tr><td class="label">Ticket ID:</td><td class="value">${ticket.ticketId}</td></tr>
        <tr><td class="label">Subject:</td><td>${ticket.subject}</td></tr>
        <tr><td class="label">From Level:</td><td>${fromLevel}</td></tr>
        <tr><td class="label">To Level:</td><td>${toLevel}</td></tr>
        <tr><td class="label">Assigned Agent:</td><td>${nextLevelAgent ? `${nextLevelAgent.name} (${nextLevelAgent.email})` : 'None (Added to Queue)'}</td></tr>
      </table>
    </div>
  `;

  await sendEmail({
    to: adminEmail,
    subject: adminSubject,
    body: getHtmlTemplate(adminSubject, 'SLA Breach Escalation Alert', adminContent),
    ticketObjectId: ticket._id,
    recipientRole: 'admin',
    notificationType: 'ticket_escalated_admin',
  });
}

/**
 * Notify customer when their ticket is reassigned to a different engineer by admin.
 * In-app notification only — no email to customer.
 */
async function notifyTicketReassigned(ticket, customer) {
  await createCustomerNotification(
    customer,
    ticket,
    'ticket_reassigned',
    '🔀 Ticket Reassigned',
    `Your ticket ${ticket.ticketId} — "${ticket.subject}" has been reassigned to a new engineer. ` +
    `Work will continue without interruption.`
  );
}

module.exports = {
  notifyTicketCreated,
  notifyTicketAssigned,
  notifyStatusChanged,
  notifyTicketResolved,
  notifyTicketClosed,
  notifyTicketEscalated,
  notifyTicketReassigned,
};
