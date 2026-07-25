const cron = require('node-cron');
const Ticket = require('../models/Ticket');
const SupportAgent = require('../models/SupportAgent');
const { sendEmail } = require('../services/emailService');

/**
 * Generates EOD report metrics and sends summary email to the system administrator.
 */
async function generateAndSendDailySummary() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@swiftdesk.com';
  console.log(`[Daily Job] Running EOD Admin Summary Job for: ${adminEmail}`);

  try {
    const total = await Ticket.countDocuments();
    const openCount = await Ticket.countDocuments({ status: 'Open' });
    const assignedCount = await Ticket.countDocuments({ status: 'Assigned' });
    const inProgressCount = await Ticket.countDocuments({ status: 'In Progress' });
    const resolvedCount = await Ticket.countDocuments({ status: 'Resolved' });
    const closedCount = await Ticket.countDocuments({ status: 'Closed' });
    
    const pendingCount = openCount + assignedCount + inProgressCount;
    const resolvedTotal = resolvedCount + closedCount;
    const slaBreaches = await Ticket.countDocuments({ slaBreached: true });

    // Count tickets with at least one escalation entry
    const escalations = await Ticket.countDocuments({
      'escalationHistory.0': { $exists: true },
    });

    // Compute average resolution time in hours
    const resolvedTickets = await Ticket.find({
      resolvedAt: { $ne: null },
    }, 'createdAt resolvedAt');
    
    let averageResolutionTime = 'N/A';
    if (resolvedTickets.length > 0) {
      const totalMs = resolvedTickets.reduce((acc, ticket) => {
        return acc + (new Date(ticket.resolvedAt) - new Date(ticket.createdAt));
      }, 0);
      const avgHours = (totalMs / resolvedTickets.length) / (1000 * 60 * 60);
      averageResolutionTime = `${avgHours.toFixed(1)} hours`;
    }

    // Engineer workloads
    const engineers = await SupportAgent.find({ isActive: true }).sort({ active_tickets: -1 });
    const engineerWorkloadList = engineers.map(eng => {
      return `<li><strong>${eng.name}</strong> (${eng.level}): ${eng.active_tickets}/${eng.max_capacity} tickets (${eng.status})</li>`;
    }).join('');

    // Top pending tickets (e.g. oldest 5 pending tickets or by priority)
    const topPending = await Ticket.find({
      status: { $in: ['Open', 'Assigned', 'In Progress'] }
    })
    .sort({ priority: -1, createdAt: 1 }) // priority desc (Critical, High...), then oldest first
    .limit(5)
    .populate('customer', 'name');

    const topPendingList = topPending.map(t => {
      const customerName = t.customer?.name || 'Unknown';
      return `<li>[${t.ticketId}] <strong>${t.subject}</strong> - Priority: ${t.priority} | Customer: ${customerName} | Status: ${t.status}</li>`;
    }).join('');

    const subject = `[SwiftDesk Admin Summary] Daily Support Performance Report`;
    const body = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #4f46e5; border-bottom: 2px solid #4f46e5; padding-bottom: 8px;">SwiftDesk Operations EOD Summary</h2>
        <p>Hello Admin,</p>
        <p>Please find below the operational dashboard report for today.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f8fafc;">
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Metric</th>
            <th style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">Count</th>
          </tr>
          <tr><td style="padding: 8px 10px; border-bottom: 1px solid #eee;">Total Tickets Registered</td><td style="text-align: right; font-weight: bold;">${total}</td></tr>
          <tr><td style="padding: 8px 10px; border-bottom: 1px solid #eee; color: #3b82f6;">Pending Workload</td><td style="text-align: right; font-weight: bold; color: #3b82f6;">${pendingCount}</td></tr>
          <tr><td style="padding: 8px 10px; border-bottom: 1px solid #eee; color: #10b981;">Resolved & Closed</td><td style="text-align: right; font-weight: bold; color: #10b981;">${resolvedTotal}</td></tr>
          <tr><td style="padding: 8px 10px; border-bottom: 1px solid #eee; color: #ef4444;">SLA Breaches</td><td style="text-align: right; font-weight: bold; color: #ef4444;">${slaBreaches}</td></tr>
          <tr><td style="padding: 8px 10px; border-bottom: 1px solid #eee; color: #f59e0b;">Total Escalations</td><td style="text-align: right; font-weight: bold; color: #f59e0b;">${escalations}</td></tr>
          <tr><td style="padding: 8px 10px; border-bottom: 1px solid #eee;">Average Resolution Time</td><td style="text-align: right; font-weight: bold;">${averageResolutionTime}</td></tr>
        </table>

        <h3 style="color: #334155; margin-top: 24px;">Support Engineers Workload</h3>
        <ul>
          ${engineerWorkloadList || '<li>No active support engineers found.</li>'}
        </ul>

        <h3 style="color: #334155; margin-top: 24px;">Top Pending Tickets requiring attention</h3>
        <ul>
          ${topPendingList || '<li>No pending tickets currently in the system.</li>'}
        </ul>
        
        <p style="font-size: 11px; color: #888; margin-top: 40px; border-top: 1px solid #eee; padding-top: 10px;">
          This is an automated EOD operations summary compiled by the SwiftDesk monitoring system.
        </p>
      </div>
    `;

    await sendEmail({
      to: adminEmail,
      subject,
      body,
      recipientRole: 'admin',
      notificationType: 'daily_summary',
    });
    console.log('[Daily Job] EOD Admin Summary report sent successfully.');
  } catch (err) {
    console.error('[Daily Job Error] Failed to compile daily summary report:', err.message);
  }
}

/**
 * Bootstrap the EOD report cron job.
 * Runs daily at midnight (0 0 * * *).
 */
function startDailySummaryJob() {
  // Run daily at midnight
  cron.schedule('0 0 * * *', async () => {
    await generateAndSendDailySummary();
  });
  console.log('⏱  Daily Summary Report Job scheduled: "0 0 * * *"');
}

module.exports = {
  startDailySummaryJob,
  generateAndSendDailySummary,
};
