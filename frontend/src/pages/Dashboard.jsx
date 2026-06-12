import { useEffect, useMemo, useState } from 'react'
import { useAccounts } from '../hooks/useAccounts'
import { useExpenses } from '../hooks/useExpenses'
import { useIncome } from '../hooks/useIncome'
import { useNetWorth } from '../hooks/useNetWorth'
import { useSafeToSpend } from '../hooks/useSafeToSpend'
import { useSpendingMoney } from '../hooks/useSpendingMoney'
import { useToast } from '../context/ToastContext'
import { useAdvisorChatContext } from '../context/AdvisorChatContext'
import { apiStream } from '../lib/api'
import {
  formatMoney,
  formatDate,
  isDebt,
  monthlyEquiv,
  nextPaydayDate,
} from '../lib/utils'
import StatCard from '../components/ui/StatCard'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import Markdown from '../components/ui/Markdown'
import AdvisorChat from '../components/dashboard/AdvisorChat'
import NetWorthHero from '../components/dashboard/NetWorthHero'
import AccountsSnapshot from '../components/dashboard/AccountsSnapshot'

const RECOMMEND_PROMPT = 'What should I prioritize this month?'

function resolvedBalance(a) {
  return a.current_balance ?? a.balance ?? 0
}

export default function Dashboard() {
  const { accounts, loading: accountsLoading, refetch: refetchAccounts } = useAccounts()
  const { expenses, loading: expensesLoading, refetch: refetchExpenses } = useExpenses()
  const { income, loading: incomeLoading, refetch: refetchIncome } = useIncome()
  const { series: netWorthSeries, loading: netWorthLoading } = useNetWorth()
  const { summary: safeToSpend, refetch: refetchSafeToSpend } = useSafeToSpend()
  const { summary: spendingMoney, refetch: refetchSpendingMoney } = useSpendingMoney()
  const { showToast } = useToast()
  const { registerRefresh } = useAdvisorChatContext()

  // Keep the dashboard's data fresh after an advisor write, even one made from
  // the shared chat widget here.
  useEffect(
    () => registerRefresh(() => {
      refetchAccounts(); refetchExpenses(); refetchIncome(); refetchSafeToSpend(); refetchSpendingMoney()
    }),
    [registerRefresh, refetchAccounts, refetchExpenses, refetchIncome, refetchSafeToSpend, refetchSpendingMoney],
  )

  const [recommendation, setRecommendation] = useState(null)
  const [recLoading, setRecLoading] = useState(false)

  const loading = accountsLoading || expensesLoading || incomeLoading

  // ── Stat tiles (all computed client-side from existing hooks/utils) ──────────
  const stats = useMemo(() => {
    const debtAccounts = accounts.filter((a) => isDebt(a.type))
    const totalDebt = debtAccounts.reduce((s, a) => s + resolvedBalance(a), 0)

    // Next payday: soonest next payday across active recurring income; expected
    // amount = sum of the per-period amounts that land on that date.
    const paydays = income
      .map((i) => ({ date: nextPaydayDate(i.last_pay_date, i.frequency), amount: i.amount ?? 0 }))
      .filter((p) => p.date)
      .sort((a, b) => a.date.localeCompare(b.date))
    const nextPay = paydays[0]?.date ?? null
    const nextPayAmount = nextPay
      ? paydays.filter((p) => p.date === nextPay).reduce((s, p) => s + p.amount, 0)
      : 0

    // Monthly cash flow: income monthly-equiv − recurring-expense monthly-equiv.
    // Recurring expenses (due_day) are monthly, so their amount IS the monthly equiv.
    const monthlyIncome = income.reduce((s, i) => s + monthlyEquiv(i.amount ?? 0, i.frequency), 0)
    const monthlyExpense = expenses
      .filter((e) => e.is_recurring)
      .reduce((s, e) => s + (e.amount ?? 0), 0)
    const cashFlow = Math.round(monthlyIncome - monthlyExpense)

    return { totalDebt, nextPay, nextPayAmount, cashFlow }
  }, [accounts, expenses, income])

  // Recommendation: folded into the chat endpoint (Phase 2). The canned
  // monthly-plan prompt streams back markdown text; no tool/confirmation.
  async function handleGetRecommendation() {
    setRecLoading(true)
    setRecommendation(null)
    let acc = ''
    let failed = false
    await apiStream('/api/ai/chat', { messages: [{ role: 'user', content: RECOMMEND_PROMPT }] }, {
      onText: (delta) => { acc += delta; setRecommendation(acc) },
      onError: () => { failed = true },
    })
    if (failed && !acc) showToast('Failed to get recommendation', 'error')
    setRecLoading(false)
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
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; color: #111; line-height: 1.6; }
          @media (min-width: 640px) { body { padding: 40px; } }
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
        <Spinner size="lg" className="text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero: net-worth chart */}
      <NetWorthHero series={netWorthSeries} loading={netWorthLoading} />

      {/* Stat tiles — 5-up on desktop (Phase 3c: added Spending money), 2-up on mobile */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Next payday"
          value={stats.nextPay ? formatDate(stats.nextPay) : '—'}
          subtitle={stats.nextPay ? `${formatMoney(stats.nextPayAmount)} expected` : 'No recurring income'}
        />
        <StatCard
          label="Safe to spend"
          value={safeToSpend?.available != null ? formatMoney(safeToSpend.available) : '—'}
          valueColor={(safeToSpend?.available ?? 0) >= 0 ? 'text-credit' : 'text-debit'}
          subtitle={
            safeToSpend?.next_payday
              ? `before ${formatDate(safeToSpend.next_payday.date)}`
              : 'after upcoming bills'
          }
        />
        <StatCard
          label="Spending money / mo"
          value={spendingMoney?.has_budget ? formatMoney(spendingMoney.spending_money) : '—'}
          valueColor={(spendingMoney?.spending_money ?? 0) >= 0 ? 'text-credit' : 'text-debit'}
          subtitle={spendingMoney?.has_budget ? 'after bills & budget' : 'set a budget in Settings'}
        />
        <StatCard
          label="Total debt"
          value={formatMoney(stats.totalDebt)}
          valueColor="text-debit"
        />
        <StatCard
          label="Monthly cash flow"
          value={formatMoney(stats.cashFlow)}
          valueColor={stats.cashFlow >= 0 ? 'text-credit' : 'text-debit'}
          subtitle="income − recurring expenses"
        />
      </div>

      {/* Accounts snapshot — grouped Debts / Assets */}
      <AccountsSnapshot accounts={accounts} />

      {/* Monthly recommendation (streamed; entry point preserved from Phase 2) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-text">Monthly recommendation</h2>
            <div className="flex gap-2">
              {recommendation && (
                <Button variant="outline" size="sm" onClick={handleSavePdf}>
                  Save as PDF
                </Button>
              )}
              <Button size="sm" onClick={handleGetRecommendation} loading={recLoading}>
                {recommendation ? 'Refresh' : 'Generate'}
              </Button>
            </div>
          </div>
        </CardHeader>
        {(recLoading || recommendation) && (
          <CardBody>
            {recLoading && !recommendation ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="text-accent" />
              </div>
            ) : (
              <Markdown>{recommendation}</Markdown>
            )}
          </CardBody>
        )}
      </Card>

      {/* Advisor Chat — compact widget: latest response only; full thread lives on the Chat page */}
      <AdvisorChat variant="compact" />
    </div>
  )
}
