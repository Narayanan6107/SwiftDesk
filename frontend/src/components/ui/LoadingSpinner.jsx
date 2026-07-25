export default function LoadingSpinner({ size = 'md', color = 'indigo', label = 'Loading…' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12', xl: 'w-16 h-16' };
  const colors = {
    indigo: 'border-indigo-600',
    white: 'border-white',
    slate: 'border-slate-400',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3" role="status" aria-label={label}>
      <div
        className={`${sizes[size]} rounded-full border-4 border-slate-200 ${colors[color]}
          border-t-current animate-spin`}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm z-40">
      <LoadingSpinner size="xl" />
    </div>
  );
}
