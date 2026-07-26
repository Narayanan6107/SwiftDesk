/**
 * SwiftDesk API Client
 * Communicates with the Express backend via /api (proxied by Vite in dev).
 */

const BASE_URL = '/api';

/**
 * Generic fetch wrapper with consistent error handling.
 */
async function request(path, options = {}) {
  const token = localStorage.getItem('jwt_token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(json.message || `Request failed with status ${res.status}`);
    err.status = res.status;
    err.data = json;
    throw err;
  }

  return json;
}

// ── Auth API ─────────────────────────────────────────────────────────────────

export async function login(email, password) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function register(full_name, email, password) {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ full_name, email, password }),
  });
}

// ── Ticket API ───────────────────────────────────────────────────────────────

/**
 * Create a new support ticket.
 * @param {{ subject, description, category, priority, customer: { name, email } }} data
 */
export async function createTicket(data) {
  return request('/tickets', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Fetch all tickets, optionally filtered.
 * @param {{ email?, status?, category?, priority?, page?, limit? }} params
 */
export async function getTickets(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
  ).toString();
  return request(`/tickets${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch a single ticket by its ticketId (e.g. "SD-10001") or MongoDB _id.
 */
export async function getTicketById(id) {
  return request(`/tickets/${id}`);
}

/**
 * Update ticket status.
 * @param {string} id - ticketId or _id
 * @param {string} status - new status
 * @param {string} [by] - who is making the change
 */
export async function updateTicketStatus(id, status, by = 'Customer') {
  return request(`/tickets/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, by }),
  });
}

/**
 * Add a comment/note to the ticket activity log.
 * @param {string} id - ticketId or _id
 * @param {{ type?, message, by? }} activity
 */
export async function addActivity(id, activity) {
  return request(`/tickets/${id}/activity`, {
    method: 'POST',
    body: JSON.stringify(activity),
  });
}

/**
 * Add an internal note/comment to the ticket.
 */
export async function addNote(id, body, author) {
  return request(`/tickets/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body, author }),
  });
}

/**
 * Fetch the audit log trail for a ticket.
 */
export async function getTicketAudit(id) {
  return request(`/tickets/${id}/audit`);
}

/**
 * Close (soft-delete) a ticket.
 */
export async function closeTicket(id) {
  return request(`/tickets/${id}`, { method: 'DELETE' });
}

/**
 * Check backend health.
 */
export async function healthCheck() {
  return request('/health');
}

// ── Admin API ────────────────────────────────────────────────────────────────

export async function getEngineers() {
  return request('/admin/engineers');
}

export async function reassignTicket(ticketId, agentId) {
  return request(`/admin/tickets/${ticketId}/reassign`, {
    method: 'PATCH',
    body: JSON.stringify({ agentId }),
  });
}

export async function getAnalytics() {
  return request('/admin/analytics');
}

export async function getDailySummaryReport() {
  return request('/admin/daily-summary/report');
}

export async function triggerDailySummaryEmail() {
  return request('/admin/daily-summary/trigger', {
    method: 'POST',
  });
}

// ── Notification API ──────────────────────────────────────────────────────────

/**
 * Get the 10 most recent in-app notifications for the logged-in customer.
 */
export async function getNotifications() {
  return request('/notifications');
}

/**
 * Get the count of unread notifications for the logged-in customer.
 */
export async function getUnreadCount() {
  return request('/notifications/unread-count');
}

/**
 * Mark a single notification as read by its MongoDB _id.
 * @param {string} id - Notification _id
 */
export async function markNotificationRead(id) {
  return request(`/notifications/${id}/read`, { method: 'PATCH' });
}

/**
 * Mark ALL notifications as read for the logged-in customer.
 */
export async function markAllNotificationsRead() {
  return request('/notifications/read-all', { method: 'PATCH' });
}

