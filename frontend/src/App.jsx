import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import CustomerApp from './components/customer/CustomerApp';
import EngineerDashboard from './components/engineer/EngineerDashboard';
import AdminDashboard from './components/admin/AdminDashboard';
import Login from './components/auth/Login';
import Register from './components/auth/Register';
import LoadingSpinner from './components/ui/LoadingSpinner';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();

  if (loading) return <div className="h-screen flex justify-center items-center"><LoadingSpinner /></div>;
  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={`/${user.role}/dashboard`} />;
  }
  return children;
};

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Router>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            
            <Route 
              path="/customer/*" 
              element={
                <ProtectedRoute allowedRoles={['customer']}>
                  <CustomerApp />
                </ProtectedRoute>
              } 
            />
            
            <Route 
              path="/engineer/*" 
              element={
                <ProtectedRoute allowedRoles={['engineer']}>
                  <EngineerDashboard />
                </ProtectedRoute>
              } 
            />
            
            <Route 
              path="/admin/*" 
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <AdminDashboard />
                </ProtectedRoute>
              } 
            />
            
            <Route path="/" element={<Navigate to="/login" />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}
