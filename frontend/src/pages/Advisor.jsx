import { useAccounts } from '../hooks/useAccounts'
import { useExpenses } from '../hooks/useExpenses'
import AdvisorChat from '../components/dashboard/AdvisorChat'
import Spinner from '../components/ui/Spinner'

export default function Advisor() {
  const { accounts, loading, refetch } = useAccounts()
  const { expenses, refetch: refetchExpenses } = useExpenses()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ask Your Advisor</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ask questions about your finances or update account balances using natural language.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : (
        <AdvisorChat accounts={accounts} expenses={expenses} onUpdate={refetch} onExpenseUpdate={refetchExpenses} />
      )}
    </div>
  )
}
