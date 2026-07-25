const STEPS = ['New', 'Assigned', 'In Progress', 'Resolved', 'Closed'];

const STEP_COLORS = {
  completed: 'bg-indigo-600 border-indigo-600 text-white',
  active: 'bg-indigo-600 border-indigo-600 text-white ring-4 ring-indigo-200',
  upcoming: 'bg-white border-slate-300 text-slate-400',
};

const CONNECTOR_COLORS = {
  completed: 'bg-indigo-600',
  upcoming: 'bg-slate-200',
};

export default function StatusStepper({ currentStatus }) {
  const currentIdx = STEPS.indexOf(currentStatus);

  return (
    <div className="w-full py-4">
      <div className="flex items-center">
        {STEPS.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isActive = idx === currentIdx;
          const isLast = idx === STEPS.length - 1;

          const circleClass = isActive
            ? STEP_COLORS.active
            : isCompleted
            ? STEP_COLORS.completed
            : STEP_COLORS.upcoming;

          const connectorClass =
            idx < currentIdx ? CONNECTOR_COLORS.completed : CONNECTOR_COLORS.upcoming;

          return (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-9 h-9 rounded-full border-2 flex items-center justify-center
                    transition-all duration-500 ${circleClass}`}
                  aria-current={isActive ? 'step' : undefined}
                  title={step}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className="text-xs font-bold">{idx + 1}</span>
                  )}
                </div>
                <span
                  className={`mt-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-300
                    ${isActive ? 'text-indigo-600' : isCompleted ? 'text-slate-700' : 'text-slate-400'}`}
                >
                  {step}
                </span>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div className={`flex-1 h-0.5 mx-1 transition-all duration-500 ${connectorClass}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
