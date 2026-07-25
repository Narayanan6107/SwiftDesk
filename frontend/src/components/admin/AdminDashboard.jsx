import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import * as api from '../../services/api';
import StatusBadge from '../ui/StatusBadge';
import PriorityBadge from '../ui/PriorityBadge';
import LoadingSpinner from '../ui/LoadingSpinner';
import StatusStepper from '../ui/StatusStepper';
import ActivityTimeline from '../ui/ActivityTimeline';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' | 'tickets' | 'report'
  
  // Data states
  const [tickets, setTickets] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [report, setReport] = useState(null);
  
  // Loaders
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  
  // Filter/Search states
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [engineerFilter, setEngineerFilter] = useState('');
  const [slaFilter, setSlaFilter] = useState('');

  // Selected Ticket detail state
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [reassigning, setReassigning] = useState(false);

  // Load all support engineers
  const loadEngineers = useCallback(async () => {
    try {
      const res = await api.getEngineers();
      setEngineers(res.data || []);
    } catch (err) {
      console.error('Failed to load engineers', err);
    }
  }, []);

  // Load tickets list
  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all tickets (admin backend GET /tickets returns all if role is admin)
      const res = await api.getTickets({ limit: 100 });
      setTickets(res.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Load analytics
  const loadAnalytics = useCallback(async () => {
    try {
      const res = await api.getAnalytics();
      setAnalytics(res.data);
    } catch (err) {
      console.error('Failed to load analytics', err);
    }
  }, []);

  // Load summary report
  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const res = await api.getDailySummaryReport();
      setReport(res.data);
    } catch (err) {
      toast.error(err.message || 'Failed to load summary report');
    } finally {
      setReportLoading(false);
    }
  }, [toast]);

  // Trigger EOD summary email
  const triggerEmail = async () => {
    try {
      const res = await api.triggerDailySummaryEmail();
      toast.success(res.message || 'Summary email triggered successfully!');
    } catch (err) {
      toast.error(err.message || 'Failed to trigger email');
    }
  };

  useEffect(() => {
    loadEngineers();
    loadTickets();
    loadAnalytics();
  }, [loadEngineers, loadTickets, loadAnalytics]);

  useEffect(() => {
    if (activeTab === 'report') {
      loadReport();
    }
  }, [activeTab, loadReport]);

  // Load detailed ticket info
  const loadTicketDetail = useCallback(async (ticketId) => {
    setDetailLoading(true);
    try {
      const detailRes = await api.getTicketById(ticketId);
      setTicketDetail(detailRes.data);
      setSelectedAgentId(detailRes.data.assignedAgent?._id || '');
      
      // Fetch audit logs
      try {
        const auditRes = await api.getTicketAudit(ticketId);
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
            case 'agent_reassigned':
              message = `Reassigned to ${log.details?.toAgentName} (Level: ${log.details?.assignedLevel})`;
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
      toast.error('Failed to load ticket details');
      setActiveTicketId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeTicketId) {
      loadTicketDetail(activeTicketId);
    } else {
      setTicketDetail(null);
      setAuditLogs([]);
    }
  }, [activeTicketId, loadTicketDetail]);

  const handleReassign = async (e) => {
    e.preventDefault();
    if (!selectedAgentId || !ticketDetail) return;
    setReassigning(true);
    try {
      await api.reassignTicket(ticketDetail.ticketId, selectedAgentId);
      toast.success('Ticket successfully reassigned');
      loadTicketDetail(ticketDetail.ticketId);
      loadTickets();
      loadEngineers();
      loadAnalytics();
    } catch (err) {
      toast.error(err.message || 'Reassignment failed');
    } finally {
      setReassigning(false);
    }
  };

  // Check if an engineer is eligible based on Level capability vs Ticket priority
  const isAgentEligible = (agentLevel, priority) => {
    if (priority === 'Low') return true; // all can handle Low
    if (priority === 'Medium') return ['L2', 'L3'].includes(agentLevel);
    if (priority === 'High' || priority === 'Critical') return agentLevel === 'L3';
    return false;
  };

  // Frontend Filter Tickets logic
  const filteredTickets = tickets.filter(t => {
    const matchesSearch = 
      t.ticketId.toLowerCase().includes(search.toLowerCase()) ||
      t.subject.toLowerCase().includes(search.toLowerCase()) ||
      t.customer?.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.customer?.email?.toLowerCase().includes(search.toLowerCase());
      
    const matchesStatus = !statusFilter || t.status === statusFilter;
    const matchesPriority = !priorityFilter || t.priority === priorityFilter;
    const matchesCategory = !categoryFilter || t.category === categoryFilter;
    const matchesSla = !slaFilter || (slaFilter === 'breached' ? t.slaBreached : !t.slaBreached);
    
    const matchesEngineer = !engineerFilter || t.assignedAgent?._id === engineerFilter;

    return matchesSearch && matchesStatus && matchesPriority && matchesCategory && matchesSla && matchesEngineer;
  });

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
            <p className="text-indigo-400 text-xs font-semibold">Admin Center</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <button
            onClick={() => { setActiveTab('analytics'); setActiveTicketId(null); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'analytics' && !activeTicketId
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Overview & Analytics
          </button>
          
          <button
            onClick={() => { setActiveTab('tickets'); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'tickets'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
            Tickets Directory
          </button>

          <button
            onClick={() => { setActiveTab('report'); setActiveTicketId(null); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'report' && !activeTicketId
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
            </svg>
            Summary & Reports
          </button>
        </nav>

        {/* Admin profile */}
        <div className="px-3 py-4 border-t border-slate-800 flex flex-col gap-3">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800/60">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
              A
            </div>
            <div className="min-w-0">
              <p className="text-slate-200 text-sm font-medium truncate">System Admin</p>
              <span className="text-[10px] font-bold text-slate-900 bg-indigo-300 px-1.5 py-0.5 rounded uppercase">
                Admin
              </span>
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
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center px-6 gap-4 shrink-0 justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Admin Portal</span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-700 font-medium capitalize">
              {activeTicketId ? `Ticket ${activeTicketId}` : activeTab}
            </span>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-6">
          
          {activeTicketId ? (
            /* ────────────────────────────────────────────────────────
               TICKET DETAIL VIEW
               ──────────────────────────────────────────────────────── */
            <div className="max-w-4xl mx-auto space-y-6">
              <button
                onClick={() => setActiveTicketId(null)}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors font-medium"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to List
              </button>

              {detailLoading || !ticketDetail ? (
                <div className="flex justify-center py-24"><LoadingSpinner size="xl" /></div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left info column */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                          {ticketDetail.ticketId}
                        </span>
                        <StatusBadge status={ticketDetail.status} />
                        <PriorityBadge priority={ticketDetail.priority} />
                        <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                          {ticketDetail.category}
                        </span>
                        {ticketDetail.slaBreached && (
                          <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                            ⚠️ SLA Breached
                          </span>
                        )}
                      </div>
                      <h2 className="text-xl font-bold text-slate-800 leading-snug">{ticketDetail.subject}</h2>
                      
                      <div className="border-t border-slate-100 pt-4">
                        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">Description</p>
                        <div className="bg-slate-50 rounded-xl px-4 py-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap border border-slate-100">
                          {ticketDetail.description}
                        </div>
                      </div>
                    </div>

                    {/* Timeline */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <h3 className="font-bold text-slate-800 text-base">Timeline & Escalations</h3>
                      <ActivityTimeline activities={auditLogs} />
                    </div>
                  </div>

                  {/* Right Action Column */}
                  <div className="space-y-6">
                    {/* Reassignment Panel */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <h3 className="font-bold text-slate-800 text-base">Reassign Support Agent</h3>
                      
                      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-xs text-indigo-800 leading-relaxed">
                        ⚠️ Reassigning respects SLA routing logic. Current Priority: <strong>{ticketDetail.priority}</strong>
                      </div>

                      <form onSubmit={handleReassign} className="space-y-4">
                        <div>
                          <label className="block text-xs text-slate-500 font-medium uppercase tracking-wide mb-1.5">Select Engineer</label>
                          <select
                            value={selectedAgentId}
                            onChange={(e) => setSelectedAgentId(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="">-- Unassigned --</option>
                            {engineers.map((agent) => {
                              const eligible = isAgentEligible(agent.level, ticketDetail.priority);
                              return (
                                <option
                                  key={agent._id}
                                  value={agent._id}
                                  disabled={!eligible}
                                >
                                  {agent.name} ({agent.level}) - {agent.active_tickets}/{agent.max_capacity} active {!eligible ? '(Ineligible)' : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <button
                          type="submit"
                          disabled={reassigning || selectedAgentId === (ticketDetail.assignedAgent?._id || '')}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm hover:shadow active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                        >
                          {reassigning ? 'Reassigning...' : 'Assign Engineer'}
                        </button>
                      </form>

                      {/* Display Progress stepper */}
                      <div className="pt-4 border-t border-slate-100">
                        <StatusStepper currentStatus={ticketDetail.status} />
                      </div>
                    </div>

                    {/* Customer details */}
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
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'analytics' ? (
            /* ────────────────────────────────────────────────────────
               TAB: ANALYTICS & OVERVIEW
               ──────────────────────────────────────────────────────── */
            <div className="max-w-5xl mx-auto space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">Analytics Overview</h2>
                <p className="text-slate-500 text-sm mt-0.5">Real-time status, categories, levels, and workloads.</p>
              </div>

              {!analytics ? (
                <div className="flex justify-center py-24"><LoadingSpinner size="lg" /></div>
              ) : (
                <>
                  {/* Aggregated KPI Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <span className="text-slate-400 text-xs font-semibold block uppercase">Total SLA Breaches</span>
                      <p className="text-3xl font-extrabold text-red-600 mt-1">{analytics.slaBreaches}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <span className="text-slate-400 text-xs font-semibold block uppercase">Active Workload (Open)</span>
                      <p className="text-3xl font-extrabold text-blue-600 mt-1">
                        {(analytics.status.Open || 0) + (analytics.status.Assigned || 0) + (analytics.status['In Progress'] || 0)}
                      </p>
                    </div>
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <span className="text-slate-400 text-xs font-semibold block uppercase">Resolved Tickets</span>
                      <p className="text-3xl font-extrabold text-emerald-600 mt-1">{analytics.status.Resolved || 0}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <span className="text-slate-400 text-xs font-semibold block uppercase">Critical & High Priority</span>
                      <p className="text-3xl font-extrabold text-amber-600 mt-1">
                        {(analytics.priority.Critical || 0) + (analytics.priority.High || 0)}
                      </p>
                    </div>
                  </div>

                  {/* Distribution break down grids */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Status distribution */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider border-b border-slate-50 pb-2">Tickets by Status</h3>
                      <div className="space-y-3">
                        {Object.entries(analytics.status).map(([k, v]) => (
                          <div key={k} className="flex justify-between items-center text-sm">
                            <span className="text-slate-600 font-medium">{k}</span>
                            <span className="bg-slate-100 px-2.5 py-0.5 rounded-full font-bold text-slate-800">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Priority distribution */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider border-b border-slate-50 pb-2">Tickets by Priority</h3>
                      <div className="space-y-3">
                        {Object.entries(analytics.priority).map(([k, v]) => (
                          <div key={k} className="flex justify-between items-center text-sm">
                            <span className="text-slate-600 font-medium">{k}</span>
                            <span className="bg-slate-100 px-2.5 py-0.5 rounded-full font-bold text-slate-800">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Category distribution */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider border-b border-slate-50 pb-2">Tickets by Category</h3>
                      <div className="space-y-3">
                        {Object.entries(analytics.category).length === 0 ? (
                          <p className="text-slate-400 text-sm italic">No data</p>
                        ) : (
                          Object.entries(analytics.category).map(([k, v]) => (
                            <div key={k} className="flex justify-between items-center text-sm">
                              <span className="text-slate-600 font-medium">{k}</span>
                              <span className="bg-slate-100 px-2.5 py-0.5 rounded-full font-bold text-slate-800">{v}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Support level distribution */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                      <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider border-b border-slate-50 pb-2">Tickets by Support Level</h3>
                      <div className="space-y-3">
                        {Object.entries(analytics.levels).map(([k, v]) => (
                          <div key={k} className="flex justify-between items-center text-sm">
                            <span className="text-slate-600 font-medium">{k}</span>
                            <span className="bg-slate-100 px-2.5 py-0.5 rounded-full font-bold text-slate-800">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Support Agent Workloads */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                    <h3 className="font-bold text-slate-800 text-base">Engineer Workloads & Utilization</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <th className="px-6 py-3 text-left font-semibold">Engineer</th>
                            <th className="px-6 py-3 text-left font-semibold">Level</th>
                            <th className="px-6 py-3 text-left font-semibold">Status</th>
                            <th className="px-6 py-3 text-left font-semibold">Active workload</th>
                            <th className="px-6 py-3 text-left font-semibold">Capacity utilization</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {engineers.map(agent => {
                            const ratio = agent.active_tickets / agent.max_capacity;
                            const percent = Math.min(100, Math.round(ratio * 100));
                            return (
                              <tr key={agent._id}>
                                <td className="px-6 py-4 font-semibold text-slate-800">{agent.name}</td>
                                <td className="px-6 py-4 text-slate-500">{agent.level}</td>
                                <td className="px-6 py-4">
                                  <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                                    agent.status === 'available' ? 'bg-emerald-50 text-emerald-700' :
                                    agent.status === 'busy' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                                  }`}>
                                    {agent.status}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-slate-600">{agent.active_tickets} / {agent.max_capacity}</td>
                                <td className="px-6 py-4 min-w-[200px]">
                                  <div className="flex items-center gap-2">
                                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${
                                          percent >= 90 ? 'bg-red-500' : percent >= 60 ? 'bg-amber-500' : 'bg-indigo-600'
                                        }`}
                                        style={{ width: `${percent}%` }}
                                      />
                                    </div>
                                    <span className="text-xs font-bold text-slate-700 shrink-0">{percent}%</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : activeTab === 'tickets' ? (
            /* ────────────────────────────────────────────────────────
               TAB: TICKETS DIRECTORY (DIRECTORY, FILTERING, SEARCH)
               ──────────────────────────────────────────────────────── */
            <div className="max-w-5xl mx-auto space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">Tickets Directory</h2>
                <p className="text-slate-500 text-sm mt-0.5">Filter, search, and drill down into support tickets.</p>
              </div>

              {/* Filters */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="col-span-1 sm:col-span-2">
                  <label className="block text-xs text-slate-400 font-medium uppercase mb-1">Search subject/ID/customer</label>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 font-medium uppercase mb-1">Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"
                  >
                    <option value="">All</option>
                    <option value="Open">Open</option>
                    <option value="Assigned">Assigned</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Resolved">Resolved</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 font-medium uppercase mb-1">Priority</label>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"
                  >
                    <option value="">All</option>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 font-medium uppercase mb-1">Category</label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"
                  >
                    <option value="">All</option>
                    <option value="Technical">Technical</option>
                    <option value="Billing">Billing</option>
                    <option value="Account">Account</option>
                    <option value="Delivery">Delivery</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 font-medium uppercase mb-1">SLA Status</label>
                  <select
                    value={slaFilter}
                    onChange={(e) => setSlaFilter(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"
                  >
                    <option value="">All</option>
                    <option value="breached">Breached Only</option>
                    <option value="normal">Normal SLA</option>
                  </select>
                </div>
              </div>

              {/* Tickets list */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                {loading ? (
                  <div className="text-center py-20"><LoadingSpinner size="lg" /></div>
                ) : filteredTickets.length === 0 ? (
                  <div className="text-center py-20 text-slate-400">No tickets found matching filters.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                          <th className="px-6 py-3 text-left font-semibold">Ticket ID</th>
                          <th className="px-6 py-3 text-left font-semibold">Subject</th>
                          <th className="px-6 py-3 text-left font-semibold">Customer</th>
                          <th className="px-6 py-3 text-left font-semibold">Assigned Agent</th>
                          <th className="px-6 py-3 text-left font-semibold">Category</th>
                          <th className="px-6 py-3 text-left font-semibold">Priority</th>
                          <th className="px-6 py-3 text-left font-semibold">Status</th>
                          <th className="px-6 py-3 text-left font-semibold">SLA Status</th>
                          <th className="px-6 py-3 text-left font-semibold"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredTickets.map(ticket => (
                          <tr
                            key={ticket._id}
                            onClick={() => setActiveTicketId(ticket.ticketId)}
                            className="hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <td className="px-6 py-4 font-mono text-indigo-600 font-semibold text-xs">{ticket.ticketId}</td>
                            <td className="px-6 py-4 text-slate-700 font-medium max-w-xs truncate">{ticket.subject}</td>
                            <td className="px-6 py-4 text-slate-500 truncate max-w-[120px]" title={ticket.customer?.email}>
                              {ticket.customer?.name || 'Unknown'}
                            </td>
                            <td className="px-6 py-4 text-slate-500">
                              {ticket.assignedAgent ? `${ticket.assignedAgent.name} (${ticket.assignedLevel})` : 'Unassigned'}
                            </td>
                            <td className="px-6 py-4 text-slate-500">{ticket.category}</td>
                            <td className="px-6 py-4">
                              <PriorityBadge priority={ticket.priority} />
                            </td>
                            <td className="px-6 py-4">
                              <StatusBadge status={ticket.status} />
                            </td>
                            <td className="px-6 py-4">
                              {ticket.slaBreached ? (
                                <span className="text-red-600 font-semibold text-xs">⚠️ Breached</span>
                              ) : (
                                <span className="text-slate-400 text-xs">OK</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <button
                                onClick={(e) => { e.stopPropagation(); setActiveTicketId(ticket.ticketId); }}
                                className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold"
                              >
                                Manage
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
          ) : (
            /* ────────────────────────────────────────────────────────
               TAB: SUMMARY & REPORTS
               ──────────────────────────────────────────────────────── */
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex justify-between items-center flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">EOD Summary & Reports</h2>
                  <p className="text-slate-500 text-sm mt-0.5">Generate, audit, and log summary reports.</p>
                </div>
                <button
                  onClick={triggerEmail}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm hover:shadow transition-colors"
                >
                  ✉️ Trigger Admin Summary Email
                </button>
              </div>

              {reportLoading || !report ? (
                <div className="flex justify-center py-24"><LoadingSpinner size="lg" /></div>
              ) : (
                <div className="space-y-6">
                  {/* Summary counts */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <span className="text-slate-400 text-xs font-semibold block uppercase">Total Tickets</span>
                      <p className="text-2xl font-extrabold text-slate-800 mt-1">{report.totalTickets}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <span className="text-slate-400 text-xs font-semibold block uppercase">Resolved/Closed</span>
                      <p className="text-2xl font-extrabold text-emerald-600 mt-1">{report.resolvedTickets}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <span className="text-slate-400 text-xs font-semibold block uppercase">Pending Workload</span>
                      <p className="text-2xl font-extrabold text-blue-600 mt-1">{report.pendingTickets}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <span className="text-slate-400 text-xs font-semibold block uppercase">SLA Breaches</span>
                      <p className="text-2xl font-extrabold text-red-600 mt-1">{report.slaBreaches}</p>
                    </div>
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <span className="text-slate-400 text-xs font-semibold block uppercase">Total Escalations</span>
                      <p className="text-2xl font-extrabold text-amber-600 mt-1">{report.escalations}</p>
                    </div>
                  </div>

                  {/* Engineer workload utilization list */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
                    <h3 className="font-bold text-slate-800 text-base">Support Engineers Performance Stats</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                            <th className="px-6 py-3 text-left font-semibold">Engineer</th>
                            <th className="px-6 py-3 text-left font-semibold">Support Level</th>
                            <th className="px-6 py-3 text-left font-semibold">Availability Status</th>
                            <th className="px-6 py-3 text-left font-semibold">Active Workload</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {report.performance.map((eng, idx) => (
                            <tr key={idx}>
                              <td className="px-6 py-4 font-medium text-slate-800">
                                <div>{eng.name}</div>
                                <div className="text-xs text-slate-400 font-normal">{eng.email}</div>
                              </td>
                              <td className="px-6 py-4 text-slate-500">{eng.level}</td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                                  eng.status === 'available' ? 'bg-emerald-50 text-emerald-700' :
                                  eng.status === 'busy' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {eng.status}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-slate-700 font-bold">
                                {eng.activeTickets} / {eng.maxCapacity} active
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
