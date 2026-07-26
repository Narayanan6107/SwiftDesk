import { useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import PriorityBadge from '../ui/PriorityBadge';

const PRIORITY_ETA = {
  High: '4–8 hours',
  Medium: '1–2 business days',
  Low: '3–5 business days',
};

export default function TicketConfirmation({ ticket, onNavigate }) {
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    navigator.clipboard.writeText(ticket.ticketId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const eta = PRIORITY_ETA[ticket.priority] ?? '1–2 business days';

  return (
    <div className="max-w-xl mx-auto">
      {/* Success card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* Green header */}
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-8 py-10 text-center">
          {/* Animated checkmark */}
          <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4
            animate-bounce-once">
            <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-lg">
              <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">Ticket Submitted!</h2>
          <p className="text-emerald-100 text-sm">
            We've received your request and will respond shortly.
          </p>
        </div>

        {/* Ticket details */}
        <div className="px-8 py-6 space-y-5">
          {/* Ticket ID */}
          <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-0.5">Ticket ID</p>
              <p className="text-xl font-mono font-bold text-indigo-600">{ticket.ticketId}</p>
            </div>
            <button
              id="copy-ticket-id"
              onClick={copyId}
              title="Copy ticket ID"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                transition-all duration-200
                ${copied
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'
                }`}
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1.5">Status</p>
              <StatusBadge status={ticket.status} size="lg" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1.5">Priority</p>
              <PriorityBadge priority={ticket.priority} size="lg" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Category</p>
              <p className="text-sm font-semibold text-slate-700">{ticket.category}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Est. Response</p>
              <p className="text-sm font-semibold text-slate-700">{eta}</p>
            </div>
          </div>

          {/* Subject */}
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Subject</p>
            <p className="text-sm text-slate-700 font-medium">{ticket.subject}</p>
          </div>

          {/* Notification hint */}
          <div className="flex items-start gap-3 p-3.5 bg-indigo-50 border border-indigo-100 rounded-xl">
            <svg className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-xs text-indigo-700 leading-relaxed">
              You'll receive email notifications at <strong>{ticket.customer?.email}</strong> when your
              ticket is assigned, updated, or resolved.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-8 pb-8 flex flex-col sm:flex-row gap-3">
          <button
            id="confirmation-view-ticket"
            onClick={() => onNavigate('detail', ticket.ticketId)}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold
              rounded-xl transition-all duration-200 shadow-sm hover:shadow-md hover:shadow-indigo-200
              active:scale-95 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            View Ticket
          </button>
          <button
            id="confirmation-dashboard"
            onClick={() => onNavigate('dashboard')}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold
              rounded-xl transition-all duration-200 active:scale-95"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
