import { useEffect } from 'react';
import { useTickets } from '../../hooks/useTickets';
import StatusBadge from '../ui/StatusBadge';
import PriorityBadge from '../ui/PriorityBadge';
import StatusStepper from '../ui/StatusStepper';
import ActivityTimeline from '../ui/ActivityTimeline';
import LoadingSpinner from '../ui/LoadingSpinner';

function InfoItem({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function TicketDetail({ ticketId, onNavigate }) {
  const { currentTicket: ticket, loading, error, fetchTicketById } = useTickets({ autoFetch: false });

  useEffect(() => {
    if (ticketId) fetchTicketById(ticketId);
  }, [ticketId, fetchTicketById]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-slate-700 mb-2">Ticket Not Found</h3>
        <p className="text-slate-500 text-sm mb-6">{error}</p>
        <button
          id="detail-back-btn"
          onClick={() => onNavigate('history')}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
        >
          Back to My Tickets
        </button>
      </div>
    );
  }

  if (!ticket) return null;

  // Notification banner for important statuses
  const statusBanner = {
    Assigned: { bg: 'bg-blue-50 border-blue-200 text-blue-700', msg: '👤 Your ticket has been assigned to a support agent.' },
    'In Progress': { bg: 'bg-amber-50 border-amber-200 text-amber-700', msg: '⚙️ Our team is actively working on your issue.' },
    Resolved: { bg: 'bg-emerald-50 border-emerald-200 text-emerald-700', msg: '✅ Your ticket has been resolved. Please confirm if this resolved your issue.' },
    Closed: { bg: 'bg-slate-100 border-slate-200 text-slate-600', msg: '🔒 This ticket has been closed.' },
  };
  const banner = statusBanner[ticket.status];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back navigation */}
      <button
        id="detail-back"
        onClick={() => onNavigate('history')}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors font-medium"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to My Tickets
      </button>

      {/* Status banner */}
      {banner && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${banner.bg}`}>
          {banner.msg}
        </div>
      )}

      {/* Header card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                  {ticket.ticketId}
                </span>
                <StatusBadge status={ticket.status} />
                <PriorityBadge priority={ticket.priority} />
              </div>
              <h2 className="text-xl font-bold text-slate-800 leading-snug">{ticket.subject}</h2>
            </div>
          </div>
        </div>

        {/* Meta grid */}
        <dl className="px-6 py-5 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 border-b border-slate-100">
          <InfoItem label="Category">
            <span className="text-sm font-semibold text-slate-700">{ticket.category}</span>
          </InfoItem>
          <InfoItem label="Submitted by">
            <span className="text-sm font-semibold text-slate-700">{ticket.customer?.name}</span>
            <p className="text-xs text-slate-400 mt-0.5">{ticket.customer?.email}</p>
          </InfoItem>
          <InfoItem label="Created">
            <span className="text-sm font-semibold text-slate-700">{formatDate(ticket.createdAt)}</span>
          </InfoItem>
          <InfoItem label="Assigned To">
            <span className="text-sm font-semibold text-slate-700">{ticket.assignedTo || 'Unassigned'}</span>
          </InfoItem>
        </dl>

        {/* Status stepper */}
        <div className="px-6 py-5 border-b border-slate-100">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-3">Progress</p>
          <StatusStepper currentStatus={ticket.status} />
        </div>

        {/* Original description */}
        <div className="px-6 py-5">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-3">Description</p>
          <div className="bg-slate-50 rounded-xl px-4 py-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap border border-slate-100">
            {ticket.description}
          </div>
        </div>
      </div>

      {/* Activity timeline */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">Activity & History</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {ticket.activity?.length ?? 0} event{ticket.activity?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="px-6 py-5">
          <ActivityTimeline activities={ticket.activity ?? []} />
        </div>
      </div>
    </div>
  );
}
