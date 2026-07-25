import { useCallback, useEffect, useReducer, useRef } from 'react';
import * as api from '../services/api';

const initialState = {
  tickets: [],
  currentTicket: null,
  loading: false,
  submitting: false,
  error: null,
  pagination: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, tickets: action.tickets, pagination: action.pagination ?? null };
    case 'FETCH_ONE_SUCCESS':
      return { ...state, loading: false, currentTicket: action.ticket };
    case 'SUBMIT_START':
      return { ...state, submitting: true, error: null };
    case 'SUBMIT_SUCCESS':
      return { ...state, submitting: false, tickets: [action.ticket, ...state.tickets] };
    case 'UPDATE_TICKET':
      return {
        ...state,
        tickets: state.tickets.map((t) =>
          t._id === action.ticket._id || t.ticketId === action.ticket.ticketId ? action.ticket : t
        ),
        currentTicket:
          state.currentTicket?._id === action.ticket._id ? action.ticket : state.currentTicket,
      };
    case 'SET_ERROR':
      return { ...state, loading: false, submitting: false, error: action.error };
    default:
      return state;
  }
}

/**
 * Custom hook for managing ticket data and operations.
 * @param {{ autoFetch?: boolean, filters?: object }} options
 */
export function useTickets({ autoFetch = true, filters = {} } = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const filtersRef = useRef(filters);

  const fetchTickets = useCallback(async (params = {}) => {
    dispatch({ type: 'FETCH_START' });
    try {
      const res = await api.getTickets(params);
      dispatch({ type: 'FETCH_SUCCESS', tickets: res.data, pagination: res.pagination });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
    }
  }, []);

  const fetchTicketById = useCallback(async (id) => {
    dispatch({ type: 'FETCH_START' });
    try {
      const res = await api.getTicketById(id);
      dispatch({ type: 'FETCH_ONE_SUCCESS', ticket: res.data });
      return res.data;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
      throw err;
    }
  }, []);

  const submitTicket = useCallback(async (data) => {
    dispatch({ type: 'SUBMIT_START' });
    try {
      const res = await api.createTicket(data);
      
      // The backend returns a custom contract { ticket_id: "..." } without a nested "data" object.
      // Fetch the full ticket to satisfy frontend UI requirements.
      const fullTicketRes = await api.getTicketById(res.ticket_id);
      const fullTicket = fullTicketRes.data;
      dispatch({ type: 'SUBMIT_SUCCESS', ticket: fullTicket });
      return fullTicket;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
      throw err;
    }
  }, []);

  const refreshTicket = useCallback(async (id) => {
    try {
      const res = await api.getTicketById(id);
      dispatch({ type: 'UPDATE_TICKET', ticket: res.data });
      return res.data;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
    }
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'SET_ERROR', error: null }), []);

  useEffect(() => {
    if (autoFetch) {
      fetchTickets(filtersRef.current);
    }
  }, [autoFetch, fetchTickets]);

  return {
    ...state,
    fetchTickets,
    fetchTicketById,
    submitTicket,
    refreshTicket,
    clearError,
  };
}
