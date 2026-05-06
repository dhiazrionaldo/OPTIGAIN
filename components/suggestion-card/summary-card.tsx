interface SummaryCardProps {
  label: string
  value: string
  className?: string
  labelClass?: string
  valueClass?: string
  icon?: React.ReactNode
  themed?: { card: string; label: string; value: string; icon: string }
}

function SummaryCard({
  label,
  value,
  className = "",
  labelClass,
  valueClass,
  icon,
  themed,
}: SummaryCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl p-3 flex flex-col justify-center min-h-[56px]",
        themed?.card ?? "bg-secondary border border-border",
        className
      )}
    >
      {icon && (
        <div className="absolute -right-2 -top-2 opacity-10">
          {icon}
        </div>
      )}
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wider leading-tight mb-1 z-10",
          labelClass ?? themed?.label
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-[15px] font-semibold leading-tight z-10",
          valueClass ?? themed?.value
        )}
      >
        {value}
      </span>
    </div>
  )
}