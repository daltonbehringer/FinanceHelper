import Card from './Card'

export default function StatCard({ label, value, valueColor = 'text-gray-900', icon, subtitle }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {icon && (
          <div className="p-2 bg-gray-50 rounded-lg text-gray-400">
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
}
