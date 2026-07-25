const { sendEmail } = require('./emailService');
const Customer = require('../models/Customer');
const SupportAgent = require('../models/SupportAgent');

// Helper to generate a clean, premium HTML container
function getHtmlTemplate(title, preheader, content) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #334155; margin: 0; padding: 0; }
          .wrapper { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; border: 1px border #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.02); }
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

/**
 * Send notification to Customer when ticket is created
 */
async function notifyTicketCreated(ticket, customer) {
  const subject = `[SwiftDesk] Ticket Created: ${ticket.ticketId} - ${ticket.subject}`;
  const preheader = 'We have successfully received your support ticket.';
  const content = `
    <p>Hi ${customer.name || 'there'},</p>
    <p>Thank you for reaching out to SwiftDesk. Your ticket has been successfully registered and is being processed by our automated routing engine.</p>
    <div class="ticket-details">
      <table>
        <tr><td class="label">Ticket ID:</td><td class="value">${ticket.ticketId}</td></tr>
        <tr><td class="label">Subject:</td><td>${ticket.subject}</td></tr>
        <tr><td class="label">Category:</td><td>${ticket.category}</td></tr>
        <tr><td class="label">Priority:</td><td>${ticket.priority}</td></tr>
        <tr><td class="label">Status:</td><td>${ticket.status}</td></tr>
      </table>
    </div>
    <p>We will assign an engineer shortly and keep you updated on its progress.</p>
  `;

  await sendEmail({
    to: customer.email,
    subject,
    body: getHtmlTemplate(subject, preheader, content),
    ticketObjectId: ticket._id,
    recipientRole: 'customer',
    notificationType: 'ticket_created',
  });
}

/**
 * Send notification when ticket is assigned to an agent
 */
async function notifyTicketAssigned(ticket, customer, agent) {
  // Notify Customer
  const customerSubject = `[SwiftDesk] Ticket Assigned: ${ticket.ticketId}`;
  const customerPreheader = 'A support engineer has been assigned to your ticket.';
  const customerContent = `
    <p>Hi ${customer.name || 'there'},</p>
    <p>Your support ticket has been assigned to an engineer for investigation.</p>
    <div class="ticket-details">
      <table>
        <tr><td class="label">Ticket ID:</td><td class="value">${ticket.ticketId}</td></tr>
        <tr><td class="label">Subject:</td><td>${ticket.subject}</td></tr>
        <tr><td class="label">Assigned Agent:</td><td>${agent.name} (Support Level: ${agent.level})</td></tr>
        <tr><td class="label">Status:</td><td>${ticket.status}</td></tr>
      </table>
    </div>
  `;

  await sendEmail({
    to: customer.email,
    subject: customerSubject,
    body: getHtmlTemplate(customerSubject, customerPreheader, customerContent),
    ticketObjectId: ticket._id,
    recipientRole: 'customer',
    notificationType: 'ticket_assigned_customer',
  });

  // Notify Engineer
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
 * Send notification when ticket is escalated
 */
async function notifyTicketEscalated(ticket, customer, nextLevelAgent, fromLevel, toLevel) {
  // Notify Customer
  const customerSubject = `[SwiftDesk] Ticket Escalated: ${ticket.ticketId}`;
  const customerContent = `
    <p>Hi ${customer.name || 'there'},</p>
    <p>Your ticket has been escalated to Tier ${toLevel} to expedite its resolution.</p>
    <div class="ticket-details">
      <table>
        <tr><td class="label">Ticket ID:</td><td class="value">${ticket.ticketId}</td></tr>
        <tr><td class="label">Subject:</td><td>${ticket.subject}</td></tr>
        <tr><td class="label">New Level:</td><td>${toLevel}</td></tr>
        <tr><td class="label">Assigned Agent:</td><td>${nextLevelAgent ? nextLevelAgent.name : 'Queueing for eligible agent'}</td></tr>
      </table>
    </div>
  `;

  await sendEmail({
    to: customer.email,
    subject: customerSubject,
    body: getHtmlTemplate(customerSubject, 'Your ticket has been escalated to a higher support tier.', customerContent),
    ticketObjectId: ticket._id,
    recipientRole: 'customer',
    notificationType: 'ticket_escalated_customer',
  });

  // Notify next tier agent if assigned
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

  // Notify Admin
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
 * Send notification when ticket is resolved
 */
async function notifyTicketResolved(ticket, customer) {
  const subject = `[SwiftDesk] Ticket Resolved: ${ticket.ticketId}`;
  const content = `
    <p>Hi ${customer.name || 'there'},</p>
    <p>Our support engineer has marked your ticket as resolved.</p>
    <div class="ticket-details">
      <table>
        <tr><td class="label">Ticket ID:</td><td class="value">${ticket.ticketId}</td></tr>
        <tr><td class="label">Subject:</td><td>${ticket.subject}</td></tr>
        <tr><td class="label">Resolution:</td><td>${ticket.resolution || 'Resolution resolved.'}</td></tr>
        <tr><td class="label">Status:</td><td>${ticket.status}</td></tr>
      </table>
    </div>
    <p>If this resolves your issue, no further action is required. If you still require help, please feel free to reactivate your ticket.</p>
  `;

  await sendEmail({
    to: customer.email,
    subject,
    body: getHtmlTemplate(subject, 'Your support ticket has been resolved.', content),
    ticketObjectId: ticket._id,
    recipientRole: 'customer',
    notificationType: 'ticket_resolved',
  });
}

/**
 * Send notification when ticket is closed
 */
async function notifyTicketClosed(ticket, customer) {
  const subject = `[SwiftDesk] Ticket Closed: ${ticket.ticketId}`;
  const content = `
    <p>Hi ${customer.name || 'there'},</p>
    <p>This support ticket is now closed. Thank you for using SwiftDesk support.</p>
    <div class="ticket-details">
      <table>
        <tr><td class="label">Ticket ID:</td><td class="value">${ticket.ticketId}</td></tr>
        <tr><td class="label">Subject:</td><td>${ticket.subject}</td></tr>
        <tr><td class="label">Status:</td><td>Closed</td></tr>
      </table>
    </div>
  `;

  await sendEmail({
    to: customer.email,
    subject,
    body: getHtmlTemplate(subject, 'This support ticket has been closed.', content),
    ticketObjectId: ticket._id,
    recipientRole: 'customer',
    notificationType: 'ticket_closed',
  });
}

module.exports = {
  notifyTicketCreated,
  notifyTicketAssigned,
  notifyTicketEscalated,
  notifyTicketResolved,
  notifyTicketClosed,
};
