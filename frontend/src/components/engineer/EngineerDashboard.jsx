import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import * as api from '../../services/api';
import StatusBadge from '../ui/StatusBadge';
import PriorityBadge from '../ui/PriorityBadge';
import LoadingSpinner from '../ui/LoadingSpinner';
import StatusStepper from '../ui/StatusStepper';
import ActivityTimeline from '../ui/ActivityTimeline';

function StatCard({ label, value, color, icon }) {
  const colorMap = {
    indigo: 'from-indigo-500 to-indigo-600 shadow-indigo-200',
    blue: 'from-blue-500 to-blue-600 shadow-blue-200',
    amber: 'from-amber-400 to-amber-500 shadow-amber-200',
    emerald: 'from-emerald-500 to-emerald-600 shadow-emerald-200',
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow duration-200">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colorMap[color]} flex items-center justify-center text-white shadow-lg shrink-0`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export default function EngineerDashboard() {
  const { user, logout } = useAuth();
  const toast = useToast();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [activeTicketId, setActiveTicketId] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  
  // Note/Comment & Status Update state
  const [newStatus, setNewStatus] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [addingNote, setAddingNote] = useState(false);

  // Fetch all tickets assigned to engineer
  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTickets();
      setTickets(res.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch tickets');
      toast.error(err.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Fetch details of a single ticket
  const loadTicketDetail = useCallback(async (ticketId) => {
    setDetailLoading(true);
    try {
      const detailRes = await api.getTicketById(ticketId);
      setTicketDetail(detailRes.data);
      setNewStatus(detailRes.data.status);
      
      // Fetch audit logs
      try {
        const auditRes = await api.getTicketAudit(ticketId);
        // Map audit logs to timeline format expected by ActivityTimeline component
        const mappedLogs = (auditRes.data || []).map(log => {
          let message = '';
          switch (log.eventType) {
            case 'ticket_created':
              message = `Ticket was created with subject: "${log.details?.subject}"`;
              break;
            case 'ml_classified':
              message = `AI (ML) classified category as "${log.details?.category}" and priority as "${log.details?.priority}" (confidence: ${(log.details?.confidence * 100).toFixed(1)}%)`;
              break;
            case 'llm_validated':
              message = `AI (LLM) validated/corrected classification to "${log.details?.category}" / "${log.details?.priority}"`;
              break;
            case 'agent_assigned':
              message = `Assigned to ${log.details?.agentName} (Level: ${log.details?.assignedLevel})`;
              break;
            case 'ticket_queued':
              message = 'No available agents. Ticket added to routing queue.';
              break;
            case 'status_changed':
              message = `Status updated from "${log.details?.from}" to "${log.details?.to}"`;
              break;
            case 'ticket_escalated':
              message = `SLA breach auto-escalated to Level ${log.details?.toLevel}`;
              break;
            default:
              message = `${log.eventType.replace('_', ' ')}`;
          }
          return {
            type: log.eventType,
            message,
            by: log.performedBy || 'System',
            timestamp: log.createdAt
          };
        });
        setAuditLogs(mappedLogs);
      } catch (auditErr) {
        console.error('Failed to load audit logs', auditErr);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load ticket details');
      setActiveTicketId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (activeTicketId) {
      loadTicketDetail(activeTicketId);
    } else {
      setTicketDetail(null);
      setAuditLogs([]);
    }
  }, [activeTicketId, loadTicketDetail]);

  const handleUpdateStatus = async (e) => {
    e.preventDefault();
    if (!newStatus || newStatus === ticketDetail.status) return;
    setUpdatingStatus(true);
    try {
      await api.updateTicketStatus(ticketDetail.ticketId, newStatus, user.name || 'Engineer');
      toast.success('Ticket status updated successfully');
      loadTicketDetail(ticketDetail.ticketId);
      loadTickets();
    } catch (err) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!noteBody.trim()) return;
    setAddingNote(true);
    try {
      await api.addNote(ticketDetail.ticketId, noteBody.trim(), user.name || 'Engineer');
      toast.success('Internal note added successfully');
      setNoteBody('');
      loadTicketDetail(ticketDetail.ticketId);
    } catch (err) {
      toast.error(err.message || 'Failed to add note');
    } finally {
      setAddingNote(false);
    }
  };

  // Compute stats
  const stats = {
    total: tickets.length,
    open: tickets.filter(t => t.status === 'Open').length,
    inProgress: tickets.filter(t => t.status === 'In Progress').length,
    resolved: tickets.filter(t => t.status === 'Resolved').length,
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-64 bg-slate-900 flex flex-col shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/40">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-white font-bold text-base leading-tight tracking-tight">SwiftDesk</h1>
            <p className="text-slate-400 text-xs font-semibold">Engineer Portal</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <button
            onClick={() => setActiveTicketId(null)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              !activeTicketId
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            My Dashboard
          </button>
        </nav>

        {/* Logged in agent profile info */}
        <div className="px-3 py-4 border-t border-slate-800 flex flex-col gap-3">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800/60">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
              {user?.name ? user.name.charAt(0).toUpperCase() : 'E'}
            </div>
            <div className="min-w-0">
              <p className="text-slate-200 text-sm font-medium truncate">{user?.name || 'Engineer'}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-bold text-slate-900 bg-amber-400 px-1.5 py-0.5 rounded uppercase">
                  {user?.engineerLevel || 'Agent'}
                </span>
                <p className="text-slate-500 text-xs truncate max-w-[80px]">{user?.email}</p>
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 rounded-lg text-xs font-semibold transition-all duration-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* ── Main Panel ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center px-6 gap-4 shrink-0 justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Engineer Portal</span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-700 font-medium">
              {activeTicketId ? `Ticket ${activeTicketId}` : 'Dashboard'}
            </span>
          </div>
        </header>

        {/* Scrollable Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {activeTicketId ? (
            /* ──────────────── DETAIL VIEW ──────────────── */
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Back Link */}
              <button
                onClick={() => setActiveTicketId(null)}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors font-medium"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Dashboard
              </button>

              {detailLoading || !ticketDetail ? (
                <div className="flex justify-center py-24"><LoadingSpinner size="xl" /></div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column (Ticket Details, Description, Action, Comments) */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Header Card */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                          {ticketDetail.ticketId}
                        </span>
                        <StatusBadge status={ticketDetail.status} />
                        <PriorityBadge priority={ticketDetail.priority} />
                        <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                          {ticketDetail.category}
                        </span>
                      </div>
                      <h2 className="text-xl font-bold text-slate-800 leading-snug">{ticketDetail.subject}</h2>
                      
                      <div className="border-t border-slate-100 pt-4">
                        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">Description</p>
                        <div className="bg-slate-50 rounded-xl px-4 py-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap border border-slate-100">
                          {ticketDetail.description}
                        </div>
                      </div>
                    </div>

                    {/* Comments & Notes */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <h3 className="font-bold text-slate-800 text-base">Internal Notes</h3>
                      
                      {/* Notes list */}
                      <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
                        {!ticketDetail.notes || ticketDetail.notes.length === 0 ? (
                          <p className="text-sm text-slate-400 italic">No notes added to this ticket yet.</p>
                        ) : (
                          ticketDetail.notes.map((note, index) => (
                            <div key={index} className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1">
                              <div className="flex justify-between text-xs text-slate-500">
                                <span className="font-semibold text-slate-700">{note.author}</span>
                                <span>{new Date(note.createdAt).toLocaleString()}</span>
                              </div>
                              <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.body}</p>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Add Note form */}
                      <form onSubmit={handleAddNote} className="pt-4 border-t border-slate-100 space-y-3">
                        <div>
                          <label className="block text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Add Note</label>
                          <textarea
                            rows={3}
                            value={noteBody}
                            onChange={(e) => setNoteBody(e.target.value)}
                            placeholder="Type internal notes/comments here..."
                            required
                            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={addingNote || !noteBody.trim()}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm hover:shadow active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                        >
                          {addingNote ? 'Adding note...' : 'Save Note'}
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* Right Column (Customer Info, Status Update, Activity log) */}
                  <div className="space-y-6">
                    {/* Status Update Card */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <h3 className="font-bold text-slate-800 text-base">Actions</h3>
                      <form onSubmit={handleUpdateStatus} className="space-y-3">
                        <div>
                          <label className="block text-xs text-slate-500 font-medium uppercase tracking-wide mb-1.5">Update Status</label>
                          <select
                            value={newStatus}
                            onChange={(e) => setNewStatus(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="Open">Open</option>
                            <option value="Assigned">Assigned</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Resolved">Resolved</option>
                            <option value="Closed">Closed</option>
                          </select>
                        </div>
                        <button
                          type="submit"
                          disabled={updatingStatus || newStatus === ticketDetail.status}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm hover:shadow active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                        >
                          {updatingStatus ? 'Updating status...' : 'Update Status'}
                        </button>
                      </form>

                      {/* Display Progress stepper */}
                      <div className="pt-4 border-t border-slate-100">
                        <StatusStepper currentStatus={ticketDetail.status} />
                      </div>
                    </div>

                    {/* Customer Info Card */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-3">
                      <h3 className="font-bold text-slate-800 text-base">Customer Details</h3>
                      <div className="space-y-2 text-sm text-slate-600">
                        <div>
                          <span className="text-xs text-slate-400 font-medium uppercase block">Name</span>
                          <span className="font-semibold text-slate-800">{ticketDetail.customer?.name}</span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400 font-medium uppercase block">Email</span>
                          <span className="font-medium text-indigo-600 block break-all">{ticketDetail.customer?.email}</span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400 font-medium uppercase block">ID</span>
                          <span className="font-mono text-xs">{ticketDetail.customer?.customer_id}</span>
                        </div>
                      </div>
                    </div>

                    {/* Audit Timeline */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <h3 className="font-bold text-slate-800 text-base">Audit Trail</h3>
                      <div className="max-h-80 overflow-y-auto pr-1">
                        <ActivityTimeline activities={auditLogs} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ──────────────── DASHBOARD VIEW ──────────────── */
            <div className="max-w-5xl mx-auto space-y-8">
              {/* Info & Welcome */}
              <div>
                <h2 className="text-2xl font-bold text-slate-800">My Dashboard</h2>
                <p className="text-slate-500 text-sm mt-0.5">
                  Overview of your assigned support tickets
                </p>
              </div>

              {/* Stats Grid */}
              {loading ? (
                <div className="flex justify-center py-8"><LoadingSpinner size="lg" /></div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard
                    label="Assigned Tickets"
                    value={stats.total}
                    color="indigo"
                    icon={
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                      </svg>
                    }
                  />
                  <StatCard
                    label="Open"
                    value={stats.open}
                    color="blue"
                    icon={
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    }
                  />
                  <StatCard
                    label="In Progress"
                    value={stats.inProgress}
                    color="amber"
                    icon={
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    }
                  />
                  <StatCard
                    label="Resolved"
                    value={stats.resolved}
                    color="emerald"
                    icon={
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    }
                  />
                </div>
              )}

              {/* Tickets Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-700">Assigned Tickets</h3>
                </div>

                {loading ? (
                  <div className="text-center py-16"><LoadingSpinner size="lg" /></div>
                ) : error ? (
                  <div className="text-center py-16 text-red-500 font-medium">{error}</div>
                ) : tickets.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-slate-500 font-medium">No tickets assigned</p>
                    <p className="text-slate-400 text-sm mt-1">You are all caught up! New tickets will show up here.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                          <th className="px-6 py-3 text-left font-semibold">Ticket ID</th>
                          <th className="px-6 py-3 text-left font-semibold">Subject</th>
                          <th className="px-6 py-3 text-left font-semibold">Customer</th>
                          <th className="px-6 py-3 text-left font-semibold">Category</th>
                          <th className="px-6 py-3 text-left font-semibold">Priority</th>
                          <th className="px-6 py-3 text-left font-semibold">Status</th>
                          <th className="px-6 py-3 text-left font-semibold">Created Date</th>
                          <th className="px-6 py-3 text-left font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {tickets.map((ticket) => (
                          <tr
                            key={ticket._id}
                            onClick={() => setActiveTicketId(ticket.ticketId)}
                            className="hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <td className="px-6 py-4 font-mono text-indigo-600 font-semibold text-xs">
                              {ticket.ticketId}
                            </td>
                            <td className="px-6 py-4 text-slate-700 font-medium max-w-xs truncate">
                              {ticket.subject}
                            </td>
                            <td className="px-6 py-4 text-slate-500">
                              {ticket.customer?.name || 'Unknown'}
                            </td>
                            <td className="px-6 py-4 text-slate-500">{ticket.category}</td>
                            <td className="px-6 py-4">
                              <PriorityBadge priority={ticket.priority} />
                            </td>
                            <td className="px-6 py-4">
                              <StatusBadge status={ticket.status} />
                            </td>
                            <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                              {new Date(ticket.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveTicketId(ticket.ticketId);
                                }}
                                className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold"
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
