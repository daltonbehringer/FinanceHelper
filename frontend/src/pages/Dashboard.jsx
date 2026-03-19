import { useState } from 'react'
import { useAccounts } from '../hooks/useAccounts'
import { useExpenses } from '../hooks/useExpenses'
import { useToast } from '../context/ToastContext'
import { apiFetch } from '../lib/api'
import {
  formatMoney,
  formatDate,
  formatType,
  isDebt,
  formatRecommendation,
} from '../lib/utils'
import StatCard from '../components/ui/StatCard'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import AdvisorChat from '../components/dashboard/AdvisorChat'

const INVESTMENT_TYPES = ['401k', 'ira', 'roth_ira', 'brokerage', 'hsa']

function AccountCard({ account }) {
  const debt = isDebt(account.type)
  const investment = INVESTMENT_TYPES.includes(account.type)
  const balance = account.current_balance ?? account.balance

  const typeBadgeColor = debt ? 'red' : investment ? 'blue' : 'green'

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{account.name}</h3>
            <Badge color={typeBadgeColor} className="flex-shrink-0">
              {formatType(account.type)}
            </Badge>
          </div>
          <p className={`text-lg font-bold flex-shrink-0 ml-2 ${debt ? 'text-red-600' : 'text-green-600'}`}>
            {formatMoney(balance)}
          </p>
        </div>

        <div className="space-y-1.5 text-xs text-gray-500">
          {account.due_date && (
            <div className="flex justify-between">
              <span>Due Date</span>
              <span className="font-medium text-gray-700">{formatDate(account.due_date)}</span>
            </div>
          )}

          {account.last_updated && (
            <div className="flex justify-between">
              <span>Last Updated</span>
              <span className="text-gray-400">{formatDate(account.last_updated)}</span>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

function RecommendationContent({ items }) {
  return (
    <div className="space-y-1">
      {items.map((item) => {
        switch (item.type) {
          case 'heading':
            return (
              <div key={item.key} className="font-bold text-gray-900 text-sm pt-2 first:pt-0">
                {item.text}
              </div>
            )
          case 'bullet':
            return (
              <div key={item.key} className="pl-4 text-sm text-gray-700 flex gap-2">
                <span className="text-gray-400 select-none">&bull;</span>
                <span>{item.text}</span>
              </div>
            )
          case 'numbered':
            return (
              <div key={item.key} className="pl-4 text-sm text-gray-700">
                {item.text}
              </div>
            )
          case 'paragraph':
            return (
              <p key={item.key} className="text-sm text-gray-700">
                {item.text}
              </p>
            )
          case 'spacer':
            return <div key={item.key} className="h-2" />
          default:
            return null
        }
      })}
    </div>
  )
}

export default function Dashboard() {
  const { accounts, loading: accountsLoading, refetch: refetchAccounts } = useAccounts()
  const { expenses, loading: expensesLoading, refetch: refetchExpenses } = useExpenses()
  const { showToast } = useToast()

  const [recommendation, setRecommendation] = useState(null)
  const [recLoading, setRecLoading] = useState(false)

  const loading = accountsLoading || expensesLoading

  // Stat calculations
  const debtAccounts = accounts
    .filter((a) => isDebt(a.type))
    .sort((a, b) => {
      // Sort by due date ascending (next due first), nulls last
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    })
  const assetAccounts = accounts.filter((a) => !isDebt(a.type))

  const totalDebt = debtAccounts.reduce(
    (sum, a) => sum + (a.current_balance ?? a.balance ?? 0),
    0
  )
  const totalAssets = assetAccounts.reduce(
    (sum, a) => sum + (a.current_balance ?? a.balance ?? 0),
    0
  )
  const netWorth = totalAssets - totalDebt

  const monthlyExpenses = expenses
    .filter((e) => e.is_recurring !== 0)
    .reduce((sum, e) => sum + (e.amount ?? 0), 0)

  // Recommendation actions
  async function handleGetRecommendation() {
    setRecLoading(true)
    setRecommendation(null)
    try {
      const resp = await apiFetch('/api/ai/recommend', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      if (!resp || !resp.ok) {
        showToast('Failed to get recommendation', 'error')
        return
      }
      const data = await resp.json()
      setRecommendation(data.recommendation)
    } catch {
      showToast('Failed to get recommendation', 'error')
    } finally {
      setRecLoading(false)
    }
  }

  function handleSavePdf() {
    if (!recommendation) return
    const win = window.open('', '_blank')
    if (!win) {
      showToast('Could not open print window. Check your popup blocker.', 'error')
      return
    }
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Financial Recommendation</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; color: #111; line-height: 1.6; }
          h1 { font-size: 20px; margin-bottom: 24px; }
          pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; }
        </style>
      </head>
      <body>
        <h1>Financial Recommendation</h1>
        <pre>${recommendation.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      </body>
      </html>
    `)
    win.document.close()
    win.print()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" className="text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Net Worth"
          value={formatMoney(netWorth)}
          valueColor={netWorth >= 0 ? 'text-green-600' : 'text-red-600'}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Monthly Expenses"
          value={formatMoney(monthlyExpenses)}
          valueColor="text-gray-900"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
          }
        />
        <StatCard
          label="Total Accounts"
          value={accounts.length}
          valueColor="text-gray-900"
          subtitle={`${debtAccounts.length} debt, ${assetAccounts.length} asset`}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
            </svg>
          }
        />
        <Card
          className="ai-glow p-4 sm:p-5 cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={recLoading ? undefined : handleGetRecommendation}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">AI Budget</p>
              <p className="text-sm font-semibold text-accent leading-snug">
                {recLoading ? 'Generating...' : 'Get Recommendation'}
              </p>
            </div>
            <div className="p-1.5 sm:p-2 bg-accent/10 rounded-lg text-accent flex-shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            </div>
          </div>
        </Card>
      </div>

      {/* Recommendation result */}
      {(recLoading || recommendation) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">AI Recommendation</h2>
              <div className="flex gap-2">
                {recommendation && (
                  <>
                    <Button variant="outline" size="sm" onClick={handleSavePdf}>
                      Save as PDF
                    </Button>
                    <Button size="sm" onClick={handleGetRecommendation} loading={recLoading}>
                      Refresh
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardBody>
            {recLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="text-gray-400" />
              </div>
            ) : (
              <RecommendationContent items={formatRecommendation(recommendation)} />
            )}
          </CardBody>
        </Card>
      )}

      {/* Advisor Chat */}
      <AdvisorChat accounts={accounts} expenses={expenses} onUpdate={refetchAccounts} onExpenseUpdate={refetchExpenses} />

      {/* Account sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Debts */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Debts</h2>
          {debtAccounts.length === 0 ? (
            <Card>
              <EmptyState title="No debts" description="You have no debt accounts." />
            </Card>
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
            >
              {debtAccounts.map((a) => (
                <AccountCard key={a.id} account={a} />
              ))}
            </div>
          )}
        </div>

        {/* Assets */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Assets</h2>
          {assetAccounts.length === 0 ? (
            <Card>
              <EmptyState title="No assets" description="You have no asset accounts." />
            </Card>
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
            >
              {assetAccounts.map((a) => (
                <AccountCard key={a.id} account={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
