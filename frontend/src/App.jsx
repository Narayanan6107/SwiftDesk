import { ToastProvider } from './context/ToastContext';
import CustomerApp from './components/customer/CustomerApp';

export default function App() {
  return (
    <ToastProvider>
      <CustomerApp />
    </ToastProvider>
  );
}
