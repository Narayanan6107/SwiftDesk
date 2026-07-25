import { useEffect } from 'react';
import { useTickets } from '../../hooks/useTickets';
import StatusBadge from '../ui/StatusBadge';
import PriorityBadge from '../ui/PriorityBadge';
import LoadingSpinner from '../ui/LoadingSpinner';

const STATUS_ORDER = ['New', 'Assigned', 'In Progress', 'Resolved', 'Closed'];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatCard({ label, value, color, icon }) {
  const colorMap = {
    indigo: 'from-indigo-500 to-indigo-600 shadow-indigo-200',
    blue: 'from-blue-500 to-blue-600 shadow-blue-200',
    amber: 'from-amber-400 to-amber-500 shadow-amber-200',
    emerald: 'from-emerald-500 to-emerald-600 shadow-emerald-200',
    slate: 'from-slate-500 to-slate-600 shadow-slate-200',
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4
      hover:shadow-md transition-shadow duration-200">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colorMap[color]}
        flex items-center justify-center text-white shadow-lg shrink-0`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard({ onNavigate, customerEmail }) {
  const { tickets, loading, error, fetchTickets } = useTickets({ autoFetch: false });

  useEffect(() => {
    fetchTickets(customerEmail ? { email: customerEmail } : {});
  }, [fetchTickets, customerEmail]);

  // Compute stats
  const stats = {
    total: tickets.length,
    open: tickets.filter((t) => ['New', 'Assigned'].includes(t.status)).length,
    inProgress: tickets.filter((t) => t.status === 'In Progress').length,
    resolved: tickets.filter((t) => t.status === 'Resolved').length,
    closed: tickets.filter((t) => t.status === 'Closed').length,
  };

  const recentTickets = [...tickets]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Page heading */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Dashboard</h2>
          <p className="text-slate-500 text-sm mt-0.5">
            Overview of your support tickets
          </p>
        </div>
        <button
          id="dashboard-new-ticket"
          onClick={() => onNavigate('submit')}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700
            text-white text-sm font-semibold rounded-xl transition-all duration-200
            shadow-sm hover:shadow-md hover:shadow-indigo-200 active:scale-95"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Submit Ticket
        </button>
      </div>

      {/* Stats cards */}
      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard
              label="Total Tickets"
              value={stats.total}
              color="indigo"
              icon={
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                </svg>
              }
            />
            <StatCard
              label="Open"
              value={stats.open}
              color="blue"
              icon={
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              }
            />
            <StatCard
              label="In Progress"
              value={stats.inProgress}
              color="amber"
              icon={
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              label="Resolved"
              value={stats.resolved}
              color="emerald"
              icon={
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              label="Closed"
              value={stats.closed}
              color="slate"
              icon={
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              }
            />
          </div>

          {/* Recent tickets table */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-700">Recent Tickets</h3>
              <button
                id="dashboard-view-all"
                onClick={() => onNavigate('history')}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
              >
                View all →
              </button>
            </div>

            {recentTickets.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-slate-500 font-medium">No tickets yet</p>
                <p className="text-slate-400 text-sm mt-1">Submit your first support ticket to get started</p>
                <button
                  id="dashboard-first-ticket"
                  onClick={() => onNavigate('submit')}
                  className="mt-4 px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg
                    hover:bg-indigo-700 transition-colors"
                >
                  Submit a Ticket
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                      <th className="px-6 py-3 text-left font-semibold">Ticket ID</th>
                      <th className="px-6 py-3 text-left font-semibold">Subject</th>
                      <th className="px-6 py-3 text-left font-semibold">Category</th>
                      <th className="px-6 py-3 text-left font-semibold">Priority</th>
                      <th className="px-6 py-3 text-left font-semibold">Status</th>
                      <th className="px-6 py-3 text-left font-semibold">Created</th>
                      <th className="px-6 py-3 text-left font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentTickets.map((ticket) => (
                      <tr
                        key={ticket._id}
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => onNavigate('detail', ticket.ticketId)}
                      >
                        <td className="px-6 py-4 font-mono text-indigo-600 font-semibold text-xs">
                          {ticket.ticketId}
                        </td>
                        <td className="px-6 py-4 text-slate-700 font-medium max-w-xs truncate">
                          {ticket.subject}
                        </td>
                        <td className="px-6 py-4 text-slate-500">{ticket.category}</td>
                        <td className="px-6 py-4">
                          <PriorityBadge priority={ticket.priority} />
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={ticket.status} />
                        </td>
                        <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                          {formatDate(ticket.createdAt)}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            id={`view-ticket-${ticket.ticketId}`}
                            onClick={(e) => { e.stopPropagation(); onNavigate('detail', ticket.ticketId); }}
                            className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                          >
                            View →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Error state */}
          {error && (
            <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">{error}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
