import { useState, useEffect, useRef } from 'react';
import { useNotifications } from '../../hooks/useNotifications';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable relative time string, e.g. "2 hours ago".
 */
function timeAgo(dateStr) {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/** Type → accent colour mapping */
const TYPE_COLORS = {
  ticket_created: '#4f46e5',
  ticket_assigned: '#0891b2',
  status_changed: '#059669',
  ticket_escalated: '#dc2626',
  ticket_reassigned: '#7c3aed',
};

/** Strips leading emoji from title for the dot colour logic */
function typeColor(type) {
  return TYPE_COLORS[type] || '#6b7280';
}

// ── Bell Icon (animated when unread) ─────────────────────────────────────────

function BellIcon({ hasUnread }) {
  return (
    <svg
      className={`w-5 h-5 transition-transform duration-300 ${hasUnread ? 'animate-[wiggle_0.5s_ease-in-out]' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  );
}

// ── Single Notification Row ───────────────────────────────────────────────────

function NotificationRow({ notification, onRead }) {
  const [expanded, setExpanded] = useState(false);

  const handleClick = () => {
    if (!notification.isRead) {
      onRead(notification._id);
    }
    setExpanded((prev) => !prev);
  };

  return (
    <button
      onClick={handleClick}
      id={`notification-${notification._id}`}
      className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors duration-150 border-b border-slate-100 last:border-0 group"
    >
      <div className="flex items-start gap-3">
        {/* Unread indicator dot */}
        <span
          className="mt-1.5 w-2 h-2 rounded-full shrink-0 transition-opacity duration-200"
          style={{
            backgroundColor: typeColor(notification.type),
            opacity: notification.isRead ? 0 : 1,
          }}
        />

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={`text-sm leading-snug truncate ${
                notification.isRead
                  ? 'text-slate-500 font-normal'
                  : 'text-slate-800 font-semibold'
              }`}
            >
              {notification.title}
            </p>
            <span className="text-xs text-slate-400 shrink-0 tabular-nums">
              {timeAgo(notification.createdAt)}
            </span>
          </div>

          {/* Ticket ID badge */}
          <span className="inline-block mt-0.5 text-xs font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
            {notification.ticketId}
          </span>

          {/* Message — truncated or expanded */}
          <p
            className={`mt-1.5 text-xs text-slate-500 leading-relaxed transition-all duration-200 ${
              expanded ? '' : 'line-clamp-2'
            }`}
          >
            {notification.message}
          </p>

          {/* Expand / collapse hint */}
          <span className="mt-1 text-xs text-indigo-500 group-hover:text-indigo-700">
            {expanded ? 'Show less ↑' : 'Read more ↓'}
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
        <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-600">All caught up!</p>
      <p className="text-xs text-slate-400 mt-1">No notifications yet. Submit a ticket to get started.</p>
    </div>
  );
}

// ── Main NotificationCenter Component ─────────────────────────────────────────

/**
 * Notification bell icon + dropdown panel for the Customer Portal header.
 *
 * Displays the 10 most recent notifications, sorted newest first.
 * Polls every 30 seconds via the useNotifications hook.
 */
export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotifications();

  // Close on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  // Close panel on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <div className="relative">
      {/* ── Bell trigger button ── */}
      <button
        ref={buttonRef}
        id="notification-bell-btn"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        className={`relative p-2 rounded-lg transition-all duration-200 ${
          open
            ? 'bg-indigo-50 text-indigo-600'
            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
        }`}
      >
        <BellIcon hasUnread={unreadCount > 0} />

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            id="notification-unread-badge"
            className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white
              text-[10px] font-bold flex items-center justify-center leading-none
              animate-[pulse_2s_ease-in-out_infinite] shadow-sm"
            aria-hidden="true"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          ref={panelRef}
          role="region"
          aria-label="Notification panel"
          className="absolute right-0 top-full mt-2 w-96 max-h-[540px] flex flex-col
            bg-white rounded-2xl shadow-xl shadow-slate-200/80
            border border-slate-200 z-50
            animate-[slideDown_0.18s_ease-out]"
          style={{ minWidth: '320px' }}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-800">Notifications</h2>
              {unreadCount > 0 && (
                <span className="text-xs font-semibold text-white bg-indigo-500 px-1.5 py-0.5 rounded-full leading-none">
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                id="mark-all-read-btn"
                onClick={markAllRead}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800
                  hover:underline transition-colors duration-150 whitespace-nowrap"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto flex-1 overscroll-contain" role="list">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <EmptyState />
            ) : (
              notifications.map((n) => (
                <NotificationRow key={n._id} notification={n} onRead={markRead} />
              ))
            )}
          </div>

          {/* Panel footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 shrink-0">
              <p className="text-xs text-slate-400 text-center">
                Showing {notifications.length} most recent notification{notifications.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Keyframe animations injected via a style tag */}
      <style>{`
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-12deg); }
          75% { transform: rotate(12deg); }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
