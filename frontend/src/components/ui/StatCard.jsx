import Card from './Card'

export default function StatCard({ label, value, valueColor = 'text-gray-900', icon, subtitle }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1 break-words">{label}</p>
          <p className={`text-lg sm:text-2xl font-bold break-words ${valueColor}`}>{value}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-1 break-words">{subtitle}</p>}
        </div>
        {icon && (
          <div className="p-1.5 sm:p-2 bg-gray-50 rounded-lg text-gray-400 flex-shrink-0">
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
}
