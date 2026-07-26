import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/api';

const POLL_INTERVAL_MS = 30_000; // 30 seconds — picks up SLA escalations from cron

/**
 * useNotifications — manages in-app notifications for the Customer Portal.
 *
 * Fetches the 10 most recent notifications on mount and polls every 30 seconds
 * so background-generated notifications (escalations, queue assignments) surface
 * without requiring a page reload.
 *
 * @returns {{
 *   notifications: Array,
 *   unreadCount: number,
 *   loading: boolean,
 *   markRead: (id: string) => Promise<void>,
 *   markAllRead: () => Promise<void>,
 *   refresh: () => Promise<void>,
 * }}
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const fetchNotifications = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await getNotifications();
      setNotifications(res.data || []);
    } catch (err) {
      // Silently swallow errors during background polling to avoid noise
      if (!silent) console.error('[useNotifications] Failed to fetch:', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchNotifications(false);
  }, [fetchNotifications]);

  // Background polling
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchNotifications(true); // silent — no loading spinner during background refresh
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchNotifications]);

  /**
   * Mark a single notification as read optimistically, then sync.
   */
  const markRead = useCallback(async (id) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
    );
    try {
      await markNotificationRead(id);
    } catch (err) {
      console.error('[useNotifications] markRead failed:', err.message);
      // Revert on failure
      await fetchNotifications(true);
    }
  }, [fetchNotifications]);

  /**
   * Mark all notifications as read optimistically, then sync.
   */
  const markAllRead = useCallback(async () => {
    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await markAllNotificationsRead();
    } catch (err) {
      console.error('[useNotifications] markAllRead failed:', err.message);
      // Revert on failure
      await fetchNotifications(true);
    }
  }, [fetchNotifications]);

  return {
    notifications,
    unreadCount,
    loading,
    markRead,
    markAllRead,
    refresh: () => fetchNotifications(false),
  };
}
