import { useAccounts } from '../hooks/useAccounts'
import { useExpenses } from '../hooks/useExpenses'
import AdvisorChat from '../components/dashboard/AdvisorChat'
import Spinner from '../components/ui/Spinner'

export default function Chat() {
  const { loading, refetch } = useAccounts()
  const { refetch: refetchExpenses } = useExpenses()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Chat</h1>
        <p className="mt-1 text-sm text-gray-500">
          Chat with your financial advisor — ask questions, record payments, or update balances in plain language.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : (
        <AdvisorChat variant="full" onUpdate={refetch} onExpenseUpdate={refetchExpenses} />
      )}
    </div>
  )
}
