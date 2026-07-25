const STATUS_STYLES = {
  New: 'bg-indigo-100 text-indigo-700 ring-indigo-300',
  Assigned: 'bg-blue-100 text-blue-700 ring-blue-300',
  'In Progress': 'bg-amber-100 text-amber-700 ring-amber-300',
  Resolved: 'bg-emerald-100 text-emerald-700 ring-emerald-300',
  Closed: 'bg-slate-100 text-slate-600 ring-slate-300',
};

const STATUS_DOTS = {
  New: 'bg-indigo-500',
  Assigned: 'bg-blue-500',
  'In Progress': 'bg-amber-500',
  Resolved: 'bg-emerald-500',
  Closed: 'bg-slate-400',
};

export default function StatusBadge({ status, size = 'sm' }) {
  const base = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600 ring-slate-300';
  const dot = STATUS_DOTS[status] ?? 'bg-slate-400';
  const sizeClass = size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold rounded-full ring-1 ring-inset ${base} ${sizeClass}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {status}
    </span>
  );
}
