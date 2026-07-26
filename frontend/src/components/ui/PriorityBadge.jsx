const PRIORITY_CONFIG = {
  Low: { bg: 'bg-slate-100 text-slate-600 ring-slate-300', icon: '↓', dot: 'bg-slate-400' },
  Medium: { bg: 'bg-sky-100 text-sky-700 ring-sky-300', icon: '→', dot: 'bg-sky-500' },
  High: { bg: 'bg-orange-100 text-orange-700 ring-orange-300', icon: '↑', dot: 'bg-orange-500' },
};

export default function PriorityBadge({ priority, size = 'sm' }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.Medium;
  const sizeClass = size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold rounded-full ring-1 ring-inset ${cfg.bg} ${sizeClass}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} aria-hidden="true" />
      {priority}
    </span>
  );
}
