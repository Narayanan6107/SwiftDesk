import { useEffect, useState } from 'react';
import { useTickets } from '../../hooks/useTickets';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../ui/LoadingSpinner';

const CATEGORIES = ['Technical', 'Billing', 'General', 'Account', 'Feature Request'];
const PRIORITIES = [
  { value: 'Low', label: 'Low', desc: 'Non-urgent, general inquiry', color: 'text-slate-600' },
  { value: 'Medium', label: 'Medium', desc: 'Normal issue, timely response needed', color: 'text-sky-600' },
  { value: 'High', label: 'High', desc: 'Significant impact on operations', color: 'text-orange-600' },
];

const INITIAL = {
  subject: '',
  description: '',
  category: '',
  priority: 'Medium',
  customerName: '',
  customerEmail: '',
};

function FieldError({ msg }) {
  if (!msg) return null;
  return (
    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {msg}
    </p>
  );
}

function validate(values, requireCustomerDetails) {
  const errors = {};
  if (!values.subject.trim()) {
    errors.subject = 'Subject is required';
  } else if (values.subject.trim().length < 5) {
    errors.subject = 'Subject must be at least 5 characters';
  }
  if (!values.category) errors.category = 'Please select a category';
  if (!values.description.trim()) {
    errors.description = 'Description is required';
  } else if (values.description.trim().length < 20) {
    errors.description = 'Description must be at least 20 characters';
  }

  if (requireCustomerDetails) {
    if (!values.customerName.trim()) {
      errors.customerName = 'Customer name is required';
    }
    if (!values.customerEmail.trim()) {
      errors.customerEmail = 'Customer email is required';
    } else if (!/^\S+@\S+\.\S+$/.test(values.customerEmail.trim())) {
      errors.customerEmail = 'Customer email is not a valid email address';
    }
  }

  return errors;
}

export default function TicketSubmitForm({ onSuccess }) {
  const [values, setValues] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const { submitTicket, submitting } = useTickets({ autoFetch: false });
  const toast = useToast();
  const { user } = useAuth();

  const authCustomerName = user?.name || user?.fullName || '';
  const authCustomerEmail = user?.email || '';
  const requireCustomerDetails = !authCustomerName || !authCustomerEmail;

  useEffect(() => {
    if (!authCustomerName && !authCustomerEmail) return;
    setValues((prev) => ({
      ...prev,
      customerName: prev.customerName || authCustomerName,
      customerEmail: prev.customerEmail || authCustomerEmail,
    }));
  }, [authCustomerName, authCustomerEmail]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
    if (touched[name]) {
      setErrors((prev) => {
        const next = validate({ ...values, [name]: value }, requireCustomerDetails);
        return { ...prev, [name]: next[name] };
      });
    }
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched((t) => ({ ...t, [name]: true }));
    const next = validate(values, requireCustomerDetails);
    setErrors((prev) => ({ ...prev, [name]: next[name] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const allTouched = Object.fromEntries(Object.keys(INITIAL).map((k) => [k, true]));
    setTouched(allTouched);
    const errs = validate(values, requireCustomerDetails);
    setErrors(errs);
    if (Object.keys(errs).some((k) => errs[k])) return;

    try {
      const ticket = await submitTicket({
        subject: values.subject.trim(),
        description: values.description.trim(),
        category: values.category,
        priority: values.priority,
        customer: {
          name: (values.customerName || authCustomerName || '').trim(),
          email: (values.customerEmail || authCustomerEmail || '').trim(),
        },
      });
      toast.success(`Ticket ${ticket.ticketId} created successfully!`);
      onSuccess(ticket);
    } catch (err) {
      toast.error(err.message || 'Failed to submit ticket. Please try again.');
    }
  };

  const inputClass = (field) =>
    `w-full px-4 py-2.5 rounded-xl border text-sm text-slate-800 placeholder-slate-400
     bg-white transition-all duration-200 outline-none
     ${errors[field] && touched[field]
       ? 'border-red-400 ring-2 ring-red-100 focus:ring-red-200'
       : 'border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
     }`;

  const descLength = values.description.length;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800">Submit a Ticket</h2>
        <p className="text-slate-500 text-sm mt-1">
          Describe your issue and our team will respond as soon as possible.
        </p>
      </div>

      <form id="ticket-submit-form" onSubmit={handleSubmit} noValidate>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {/** ── Customer details section ───────────────────────────────────── */}
          {requireCustomerDetails && (
            <div className="px-6 py-5 space-y-5 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
                Customer Details
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="customerName" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Full name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="customerName"
                    name="customerName"
                    type="text"
                    value={values.customerName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Your full name"
                    className={inputClass('customerName')}
                  />
                  <FieldError msg={touched.customerName && errors.customerName} />
                </div>

                <div>
                  <label htmlFor="customerEmail" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="customerEmail"
                    name="customerEmail"
                    type="email"
                    value={values.customerEmail}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="you@example.com"
                    className={inputClass('customerEmail')}
                  />
                  <FieldError msg={touched.customerEmail && errors.customerEmail} />
                </div>
              </div>
            </div>
          )}
          {/* ── Ticket details section ───────────────────────────────────────── */}
          <div className="px-6 py-5 space-y-5">
            <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
              Ticket Details
            </h3>

            {/* Subject */}
            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-slate-700 mb-1.5">
                Subject <span className="text-red-500">*</span>
              </label>
              <input
                id="subject"
                name="subject"
                type="text"
                value={values.subject}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder="Brief description of your issue"
                maxLength={200}
                className={inputClass('subject')}
              />
              <div className="flex justify-between mt-1">
                <FieldError msg={touched.subject && errors.subject} />
                <span className="text-xs text-slate-400 ml-auto">{values.subject.length}/200</span>
              </div>
            </div>

            {/* Category + Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="category" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  id="category"
                  name="category"
                  value={values.category}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={inputClass('category')}
                >
                  <option value="">Select a category…</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <FieldError msg={touched.category && errors.category} />
              </div>

              <div>
                <label htmlFor="priority" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Priority
                </label>
                <select
                  id="priority"
                  name="priority"
                  value={values.priority}
                  onChange={handleChange}
                  className={inputClass('priority')}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Priority hint */}
            {values.priority && (
              <div className={`text-xs flex items-center gap-1.5 -mt-2 ${
                PRIORITIES.find((p) => p.value === values.priority)?.color ?? 'text-slate-500'
              }`}>
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {PRIORITIES.find((p) => p.value === values.priority)?.desc}
              </div>
            )}

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1.5">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description"
                name="description"
                rows={6}
                value={values.description}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder="Please provide as much detail as possible — steps to reproduce, error messages, screenshots description, etc."
                className={`${inputClass('description')} resize-none leading-relaxed`}
              />
              <div className="flex justify-between mt-1">
                <FieldError msg={touched.description && errors.description} />
                <span className={`text-xs ml-auto ${descLength < 20 ? 'text-amber-500' : 'text-slate-400'}`}>
                  {descLength} chars {descLength < 20 ? `(${20 - descLength} more needed)` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* ── Form footer ──────────────────────────────────────────────────── */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-4">
            <p className="text-xs text-slate-400">
              <span className="text-red-500">*</span> Required fields
            </p>
            <button
              id="ticket-submit-btn"
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700
                disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold
                rounded-xl transition-all duration-200 shadow-sm hover:shadow-md
                hover:shadow-indigo-200 active:scale-95 min-w-[140px] justify-center"
            >
              {submitting ? (
                <>
                  <LoadingSpinner size="sm" color="white" />
                  Submitting…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Submit Ticket
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
