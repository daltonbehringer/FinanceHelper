import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAccounts } from '../hooks/useAccounts'
import { useSafeToSpend } from '../hooks/useSafeToSpend'
import { useSpendingMoney } from '../hooks/useSpendingMoney'
import { useAdvisorChatContext } from '../context/AdvisorChatContext'
import { formatMoney, formatDate, isDebt } from '../lib/utils'
import AskAdvisorButton from '../components/AskAdvisorButton'
import SpendingBreakdown from '../components/dashboard/SpendingBreakdown'
import '../styles/dashboard.css'

function Arrow({ diagonal = false }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CalendarDate({ value }) {
  if (!value)
    return (
      <span className="overview-date-tile" aria-hidden="true">
        —
      </span>
    )
  const date = new Date(`${value}T12:00:00`)
  return (
    <span className="overview-date-tile" aria-hidden="true">
      <span>{date.toLocaleDateString('en-US', { month: 'short' })}</span>
      <strong>{date.getDate()}</strong>
    </span>
  )
}

function CashAllocation({ plan, loading }) {
  const ready = !loading && plan?.complete
  const parts = ready
    ? [
        { label: 'Free to spend', amount: plan.available, color: 'free' },
        {
          label: 'Bills due',
          amount: plan.account_payments + plan.expense_payments,
          color: 'bills',
        },
        { label: 'Living costs', amount: plan.living_costs, color: 'living' },
        { label: 'Early holds', amount: plan.held_back ?? 0, color: 'holds' },
        { label: 'Cash cushion', amount: plan.cash_cushion, color: 'cushion' },
      ]
    : []
  // In a shortfall, show obligations as a share of the amount needed, not as
  // percentages of cash that would exceed 100% or imply all bills are funded.
  const total = parts.reduce((sum, part) => sum + part.amount, 0)
  return (
    <section
      className="overview-panel overview-allocation"
      aria-labelledby="allocation-heading"
    >
      <div className="overview-section-head">
        <div>
          <p className="overview-kicker">THE PLAN FOR YOUR CASH</p>
          <h2 id="allocation-heading">A place for every dollar.</h2>
        </div>
        <div className="overview-checking">
          <span>Checking cash</span>
          <strong>{loading ? '—' : formatMoney(plan?.checking_balance)}</strong>
        </div>
      </div>
      {ready ? (
        <>
          <div className="overview-allocation-bar" aria-hidden="true">
            {parts
              .filter((part) => part.amount > 0)
              .map((part) => (
                <span
                  key={part.color}
                  className={`allocation-${part.color}`}
                  style={{ width: `${(part.amount / total) * 100}%` }}
                />
              ))}
          </div>
          <dl className="overview-allocation-legend">
            {parts.map((part) => (
              <div key={part.color}>
                <dt>
                  <i
                    aria-hidden="true"
                    className={`allocation-${part.color}`}
                  />
                  {part.label}
                </dt>
                <dd>{formatMoney(part.amount)}</dd>
              </div>
            ))}
          </dl>
          <p className="overview-caption">
            {plan.shortfall > 0
              ? `Your plan needs ${formatMoney(plan.shortfall)} more than your checking cash. The bar shows the total needed.`
              : 'Bills, living costs, holds, and cushion are reserved. Your next paycheck is excluded.'}
          </p>
        </>
      ) : (
        <p className="overview-muted">
          {loading
            ? 'Calculating your cash plan…'
            : plan
              ? 'Complete your cash plan below to see what is available and what is reserved.'
              : 'Your cash plan is unavailable. Refresh the page to try again.'}
        </p>
      )}
      <SpendingBreakdown summary={plan} loading={loading} />
    </section>
  )
}

function UpcomingPayments({ plan, loading }) {
  const bills = [...(plan?.bills || [])].sort(
    (a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name)
  )
  return (
    <section
      className="overview-panel overview-upcoming"
      aria-labelledby="upcoming-heading"
    >
      <div className="overview-section-head">
        <div>
          <p className="overview-kicker">PAYMENTS & EARLY HOLDS</p>
          <h2 id="upcoming-heading">Coming up.</h2>
        </div>
        <Link
          to="/expenses"
          className="overview-icon-link"
          aria-label="View all expenses"
        >
          <Arrow diagonal />
        </Link>
      </div>
      {loading ? (
        <p role="status" className="overview-empty">
          Loading upcoming payments…
        </p>
      ) : !plan ? (
        <p className="overview-empty">Upcoming payments could not be loaded.</p>
      ) : bills.length ? (
        <>
          <ul className="overview-bills">
            {bills.slice(0, 4).map((bill) => (
              <li key={`${bill.kind}-${bill.id}-${bill.due}`}>
                <Link to={bill.kind === 'account' ? '/accounts' : '/expenses'}>
                  <CalendarDate value={bill.due} />
                  <div className="overview-bill-name">
                    <strong>{bill.name}</strong>
                    <span className={bill.overdue ? 'overview-danger' : ''}>
                      {bill.overdue ? 'Overdue · ' : ''}
                      {bill.reserve_stage === 'half'
                        ? 'Early hold'
                        : 'Payment due'}
                      <span className="sr-only"> · {formatDate(bill.due)}</span>
                    </span>
                  </div>
                  <div className="overview-bill-money">
                    <strong>{formatMoney(bill.reserved ?? bill.amount)}</strong>
                    {bill.reserve_stage === 'half' && (
                      <span>of {formatMoney(bill.amount)} unpaid</span>
                    )}
                  </div>
                  <Arrow diagonal />
                </Link>
              </li>
            ))}
          </ul>
          <p className="overview-caption">
            {bills.length > 4
              ? `Showing the next 4 of ${bills.length} reserved payments. All are included in your cash plan.`
              : 'These amounts are included in your cash plan above.'}
          </p>
        </>
      ) : (
        <div className="overview-empty">
          <span className="overview-empty-mark" aria-hidden="true">
            ✓
          </span>
          <p>
            {plan.complete
              ? 'No payments reserved this period.'
              : 'No scheduled payments to show yet.'}
          </p>
          <Link to="/expenses" className="overview-text-link">
            {plan.complete ? 'Review your expenses' : 'Add your expenses'}{' '}
            <Arrow />
          </Link>
        </div>
      )}
    </section>
  )
}

function BalanceSheet({ accounts, loading }) {
  const sum = (items) =>
    items.reduce(
      (total, account) =>
        total + (account.current_balance ?? account.balance ?? 0),
      0
    )
  const assets = sum(accounts.filter((account) => !isDebt(account.type)))
  const debt = sum(accounts.filter((account) => isDebt(account.type)))
  const hasAccounts = accounts.length > 0
  return (
    <section
      className="overview-panel overview-balance"
      aria-labelledby="balance-heading"
    >
      <div className="overview-section-head">
        <div>
          <p className="overview-kicker">THE BIGGER PICTURE</p>
          <h2 id="balance-heading">Balance sheet.</h2>
        </div>
        <Link
          to="/accounts"
          className="overview-icon-link"
          aria-label="View all accounts"
        >
          <Arrow diagonal />
        </Link>
      </div>
      <p className="overview-muted">Net worth</p>
      <p
        className={`overview-net-worth ${assets - debt < 0 ? 'overview-danger' : ''}`}
      >
        {loading || !hasAccounts ? '—' : formatMoney(assets - debt)}
      </p>
      <dl className="overview-balance-rows">
        <div>
          <dt>Total assets</dt>
          <dd>{loading || !hasAccounts ? '—' : formatMoney(assets)}</dd>
        </div>
        <div>
          <dt>Total debt</dt>
          <dd>{loading || !hasAccounts ? '—' : formatMoney(debt)}</dd>
        </div>
      </dl>
      <div className="overview-balance-foot">
        <span>
          {loading
            ? 'Loading balances…'
            : hasAccounts
              ? `${accounts.length} active account${accounts.length === 1 ? '' : 's'} · latest recorded balances`
              : 'Add accounts to see your financial position.'}
        </span>
        <Link
          to={hasAccounts ? '/history' : '/accounts'}
          className="overview-text-link"
        >
          {hasAccounts ? 'View history' : 'Add an account'} <Arrow />
        </Link>
      </div>
    </section>
  )
}

export default function Dashboard() {
  const {
    accounts,
    loading: accountsLoading,
    refetch: refetchAccounts,
  } = useAccounts()
  const {
    summary: plan,
    loading: planLoading,
    refetch: refetchPlan,
  } = useSafeToSpend()
  const {
    summary: monthly,
    loading: monthlyLoading,
    refetch: refetchMonthly,
  } = useSpendingMoney()
  const { registerRefresh, pending } = useAdvisorChatContext()
  useEffect(
    () =>
      registerRefresh(() => {
        refetchAccounts()
        refetchPlan()
        refetchMonthly()
      }),
    [registerRefresh, refetchAccounts, refetchPlan, refetchMonthly]
  )

  const ready = !planLoading && plan?.complete
  const shortfall = ready && plan.shortfall > 0
  const payday = !planLoading ? plan?.next_payday : null
  const asOf = plan?.as_of || new Date().toLocaleDateString('en-CA')
  const days = payday
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${payday.date}T00:00:00Z`) -
            Date.parse(`${asOf}T00:00:00Z`)) /
            86400000
        )
      )
    : null
  const state = planLoading
    ? 'Calculating'
    : !plan
      ? 'Unable to load'
      : !ready
        ? 'Needs a little setup'
        : shortfall
          ? 'Needs attention'
          : 'Your plan is covered'

  return (
    <div className="overview">
      <header className="overview-header">
        <div>
          <p className="overview-kicker">YOUR FINANCIAL SNAPSHOT</p>
          <h1>The overview.</h1>
        </div>
        <div className="overview-header-actions">
          <span className="overview-asof">As of {formatDate(asOf)}</span>
          <Link to="/accounts" className="overview-button">
            Update balances <Arrow diagonal />
          </Link>
        </div>
      </header>

      <div className="overview-top-grid">
        <section
          className={`overview-hero ${shortfall ? 'overview-hero-warning' : ''}`}
          aria-labelledby="safe-heading"
          aria-busy={planLoading}
        >
          <div className="overview-hero-top">
            <span className="overview-kicker">YOUR MONEY, RIGHT NOW</span>
            <span className="overview-status">
              <i aria-hidden="true" />
              {state}
            </span>
          </div>
          <div className="overview-hero-value">
            <h2 id="safe-heading">Safe to spend</h2>
            <p>{ready ? formatMoney(plan.available) : '—'}</p>
          </div>
          <p className="overview-hero-description">
            {planLoading
              ? 'Putting your cash plan together…'
              : !plan
                ? 'We couldn’t load your estimate. Try refreshing the page.'
                : !ready
                  ? 'Estimate incomplete — see details below'
                  : shortfall
                    ? `${formatMoney(plan.shortfall)} short before ${formatDate(payday.date)}`
                    : 'Available after bills, living costs, and reserves.'}
          </p>
          <div className="overview-hero-foot">
            <span>
              {planLoading
                ? 'Loading…'
                : !plan
                  ? 'Unavailable'
                  : payday
                    ? `Through ${formatDate(payday.date)}`
                    : 'Plan around your next paycheck'}
            </span>
            <a href="#cash-plan" className="overview-text-link">
              See your cash plan <Arrow />
            </a>
          </div>
        </section>

        <aside
          className="overview-panel overview-outlook"
          aria-label="Income outlook"
        >
          <div className="overview-payday">
            <div className="overview-section-head">
              <h2>Next payday</h2>
              <Link
                to="/income"
                className="overview-icon-link"
                aria-label="Edit income schedule"
              >
                <Arrow diagonal />
              </Link>
            </div>
            <p className="overview-paydate">
              {payday
                ? new Date(`${payday.date}T12:00:00`).toLocaleDateString(
                    'en-US',
                    { month: 'long', day: 'numeric' }
                  )
                : 'Not scheduled'}
            </p>
            <div className="overview-payday-detail">
              <span>
                {planLoading
                  ? 'Checking your schedule…'
                  : !plan
                    ? 'Refresh to try again'
                    : payday
                      ? `${formatMoney(payday.amount)} expected`
                      : 'Add your income schedule'}
              </span>
              {days !== null && (
                <span className="overview-days">
                  {days === 0
                    ? 'Today'
                    : `In ${days} day${days === 1 ? '' : 's'}`}
                </span>
              )}
            </div>
          </div>
          <div className="overview-monthly">
            <p>Projected monthly surplus</p>
            <strong
              className={monthly?.spending_money < 0 ? 'overview-danger' : ''}
            >
              {!monthlyLoading && monthly?.has_budget
                ? formatMoney(monthly.spending_money)
                : '—'}
            </strong>
            <span>
              {monthlyLoading
                ? 'Loading forecast…'
                : monthly?.issues?.length
                  ? 'Complete required payment details'
                  : monthly?.has_budget
                    ? 'Average after bills, debt & living costs'
                    : 'Set your living-cost budget in Settings'}
            </span>
          </div>
        </aside>
      </div>

      <div id="cash-plan">
        <CashAllocation plan={plan} loading={planLoading} />
      </div>
      <div className="overview-bottom-grid">
        <UpcomingPayments plan={plan} loading={planLoading} />
        <BalanceSheet accounts={accounts} loading={accountsLoading} />
      </div>

      <AskAdvisorButton className="overview-advisor">
        <span className="overview-advisor-symbol" aria-hidden="true">
          <svg
            viewBox="0 0 32 32"
            width="28"
            height="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          >
            <path d="M16 3c0 8-5 13-13 13 8 0 13 5 13 13 0-8 5-13 13-13C21 16 16 11 16 3Z" />
          </svg>
        </span>
        <span className="overview-advisor-copy">
          <strong>
            {pending
              ? 'A payment or update needs your confirmation.'
              : 'Make your next move with a little clarity.'}
          </strong>
          <span>
            {pending
              ? 'Review the details with your advisor before applying it.'
              : 'Get recommendations based on your current finances.'}
          </span>
        </span>
        <span className="overview-advisor-action">
          {pending ? 'Review in Chat' : 'Ask advisor'} <Arrow />
        </span>
      </AskAdvisorButton>
      <p className="overview-footnote">
        A snapshot of what you’ve recorded. Keep balances and payments current
        for an accurate picture.
      </p>
    </div>
  )
}
