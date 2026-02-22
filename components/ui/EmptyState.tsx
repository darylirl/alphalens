interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && <div className="text-[#888888] mb-4">{icon}</div>}
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      <p className="text-[#888888] text-xs max-w-xs mb-4">{description}</p>
      {action}
    </div>
  )
}
