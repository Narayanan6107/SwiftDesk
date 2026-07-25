/**
 * SwiftDesk API Client
 * Communicates with the Express backend via /api (proxied by Vite in dev).
 */

const BASE_URL = '/api';

/**
 * Generic fetch wrapper with consistent error handling.
 */
async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
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
