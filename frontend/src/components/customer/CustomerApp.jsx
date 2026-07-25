import { useState } from 'react';
import CustomerLayout from './CustomerLayout';
import Dashboard from './Dashboard';
import TicketSubmitForm from './TicketSubmitForm';
import TicketConfirmation from './TicketConfirmation';
import TicketHistory from './TicketHistory';
import TicketDetail from './TicketDetail';

/**
 * Root of the customer module.
 * Implements simple state-based routing (no router library required).
 */
export default function CustomerApp() {
  // page: 'dashboard' | 'submit' | 'confirmation' | 'history' | 'detail'
  const [page, setPage] = useState('dashboard');
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [createdTicket, setCreatedTicket] = useState(null);

  /**
   * Navigate to a page.
   * @param {'dashboard'|'submit'|'history'|'detail'|'confirmation'} target
   * @param {string} [id] - ticketId for detail view
   */
  const navigate = (target, id) => {
    setPage(target);
    if (id) setActiveTicketId(id);
  };

  /** Called when ticket submission succeeds */
  const handleTicketCreated = (ticket) => {
    setCreatedTicket(ticket);
    setPage('confirmation');
  };

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <Dashboard onNavigate={navigate} />;
      case 'submit':
        return <TicketSubmitForm onSuccess={handleTicketCreated} />;
      case 'confirmation':
        return createdTicket ? (
          <TicketConfirmation ticket={createdTicket} onNavigate={navigate} />
        ) : (
          <Dashboard onNavigate={navigate} />
        );
      case 'history':
        return <TicketHistory onNavigate={navigate} />;
      case 'detail':
        return <TicketDetail ticketId={activeTicketId} onNavigate={navigate} />;
      default:
        return <Dashboard onNavigate={navigate} />;
    }
  };

  // Map detail/confirmation to sidebar-active page
  const sidebarPage =
    page === 'confirmation' ? 'submit'
    : page === 'detail' ? 'history'
    : page;

  return (
    <CustomerLayout currentPage={sidebarPage} onNavigate={navigate}>
      {renderPage()}
    </CustomerLayout>
  );
}
