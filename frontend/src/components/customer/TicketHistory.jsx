import { useEffect, useState } from 'react';
import { useTickets } from '../../hooks/useTickets';
import StatusBadge from '../ui/StatusBadge';
import PriorityBadge from '../ui/PriorityBadge';
import LoadingSpinner from '../ui/LoadingSpinner';

const STATUS_OPTIONS = ['', 'New', 'Assigned', 'In Progress', 'Resolved', 'Closed'];
const CATEGORY_OPTIONS = ['', 'Technical', 'Billing', 'General', 'Account', 'Feature Request'];
const PRIORITY_OPTIONS = ['', 'Low', 'Medium', 'High'];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function TicketHistory({ onNavigate }) {
  const { tickets, loading, error, pagination, fetchTickets } = useTickets({ autoFetch: false });

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', category: '', priority: '' });
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    const params = { page, limit: 10 };
    if (filters.status) params.status = filters.status;
    if (filters.category) params.category = filters.category;
    if (filters.priority) params.priority = filters.priority;
    fetchTickets(params);
  }, [fetchTickets, filters, page]);

  const handleFilterChange = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const handleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('asc'); }
  };

  // Client-side search filter + sort on top of server-fetched data
  const filtered = tickets
    .filter((t) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        t.ticketId?.toLowerCase().includes(s) ||
        t.subject?.toLowerCase().includes(s) ||
        t.category?.toLowerCase().includes(s)
      );
    })
    .sort((a, b) => {
      let va = a[sortBy] ?? '';
      let vb = b[sortBy] ?? '';
      if (sortBy === 'createdAt') { va = new Date(va); vb = new Date(vb); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const SortIcon = ({ col }) => (
    <span className={`ml-1 inline-block transition-transform ${sortBy === col ? 'opacity-100' : 'opacity-30'}`}>
      {sortBy === col && sortDir === 'desc' ? '↓' : '↑'}
    </span>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">My Tickets</h2>
          <p className="text-slate-500 text-sm mt-0.5">
            {pagination ? `${pagination.total} ticket${pagination.total !== 1 ? 's' : ''} total` : ''}
          </p>
        </div>
        <button
          id="history-new-ticket"
          onClick={() => onNavigate('submit')}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700
            text-white text-sm font-semibold rounded-xl transition-all duration-200
            shadow-sm hover:shadow-md hover:shadow-indigo-200 active:scale-95"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Ticket
        </button>
      </div>

      {/* Filters bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              id="ticket-search"
              type="search"
              placeholder="Search by ID, subject…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg
                focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100
                placeholder-slate-400 text-slate-700"
            />
          </div>

          {/* Status filter */}
          <select
            id="filter-status"
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600
              focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Category filter */}
          <select
            id="filter-category"
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600
              focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
          >
            <option value="">All Categories</option>
            {CATEGORY_OPTIONS.filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Priority filter */}
          <select
            id="filter-priority"
            value={filters.priority}
            onChange={(e) => handleFilterChange('priority', e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600
              focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
          >
            <option value="">All Priorities</option>
            {PRIORITY_OPTIONS.filter(Boolean).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          {/* Clear filters */}
          {(filters.status || filters.category || filters.priority || search) && (
            <button
              id="clear-filters"
              onClick={() => { setFilters({ status: '', category: '', priority: '' }); setSearch(''); setPage(1); }}
              className="text-sm text-red-500 hover:text-red-700 font-medium transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-slate-500 font-medium">No tickets found</p>
            <p className="text-slate-400 text-sm mt-1">Try adjusting your filters or submit a new ticket</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-100">
                    <th className="px-6 py-3 text-left font-semibold">
                      <button id="sort-id" onClick={() => handleSort('ticketId')} className="flex items-center hover:text-slate-700">
                        ID <SortIcon col="ticketId" />
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left font-semibold">
                      <button id="sort-subject" onClick={() => handleSort('subject')} className="flex items-center hover:text-slate-700">
                        Subject <SortIcon col="subject" />
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left font-semibold">Category</th>
                    <th className="px-6 py-3 text-left font-semibold">Priority</th>
                    <th className="px-6 py-3 text-left font-semibold">Status</th>
                    <th className="px-6 py-3 text-left font-semibold">
                      <button id="sort-date" onClick={() => handleSort('createdAt')} className="flex items-center hover:text-slate-700">
                        Created <SortIcon col="createdAt" />
                      </button>
                    </th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((ticket) => (
                    <tr
                      key={ticket._id}
                      className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                      onClick={() => onNavigate('detail', ticket.ticketId)}
                    >
                      <td className="px-6 py-4 font-mono text-indigo-600 font-semibold text-xs whitespace-nowrap">
                        {ticket.ticketId}
                      </td>
                      <td className="px-6 py-4 text-slate-700 font-medium max-w-xs">
                        <span className="line-clamp-1">{ticket.subject}</span>
                      </td>
                      <td className="px-6 py-4 text-slate-500 whitespace-nowrap">{ticket.category}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <PriorityBadge priority={ticket.priority} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={ticket.status} />
                      </td>
                      <td className="px-6 py-4 text-slate-400 whitespace-nowrap text-xs">
                        {formatDate(ticket.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          id={`view-${ticket.ticketId}`}
                          onClick={(e) => { e.stopPropagation(); onNavigate('detail', ticket.ticketId); }}
                          className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold
                            opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && pagination.pages > 1 && (
              <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Page {pagination.page} of {pagination.pages} ({pagination.total} tickets)
                </p>
                <div className="flex gap-2">
                  <button
                    id="prev-page"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg
                      disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors text-slate-600"
                  >
                    ← Prev
                  </button>
                  <button
                    id="next-page"
                    disabled={page >= pagination.pages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg
                      disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors text-slate-600"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="flex items-center gap-3 m-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
