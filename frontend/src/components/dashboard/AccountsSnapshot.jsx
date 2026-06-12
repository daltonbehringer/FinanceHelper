import { Link } from 'react-router-dom'
import Card, { CardHeader, CardBody } from '../ui/Card'
import Badge from '../ui/Badge'
import EmptyState from '../ui/EmptyState'
import { daysUntil, formatDate, formatMoney, formatRate, isDebt } from '../../lib/utils'

function resolvedBalance(a) {
  return a.current_balance ?? a.balance ?? 0
}

function DueDate({ dueDate }) {
  if (!dueDate) return null
  const days = daysUntil(dueDate)
  const soon = days != null && days >= 0 && days <= 7
  return (
    <span className={`text-xs tnum ${soon ? 'text-warning font-medium' : 'text-text-subtle'}`}>
      Due {formatDate(dueDate)}
      {soon && (days === 0 ? ' · today' : ` · ${days}d`)}
    </span>
  )
}

function AccountRow({ account, debt }) {
  const rate = account.interest_rate
  return (
    <Link
      to="/accounts"
      className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-border last:border-0 hover:bg-surface-raised/50 transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-text truncate">{account.name}</span>
          {rate != null && rate !== 0 && (
            <Badge color="gray" size="sm" className="flex-shrink-0">{formatRate(rate)}</Badge>
          )}
        </div>
        {debt && <DueDate dueDate={account.due_date} />}
      </div>
      <span className={`text-sm font-semibold tnum flex-shrink-0 ${debt ? 'text-debit' : 'text-text'}`}>
        {formatMoney(resolvedBalance(account))}
      </span>
    </Link>
  )
}

function Group({ title, accounts, debt, emptyLabel }) {
  const total = accounts.reduce((s, a) => s + resolvedBalance(a), 0)
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <span className={`text-sm font-semibold tnum ${debt ? 'text-debit' : 'text-text'}`}>
            {formatMoney(total)}
          </span>
        </div>
      </CardHeader>
      {accounts.length === 0 ? (
        <CardBody>
          <EmptyState title={emptyLabel} />
        </CardBody>
      ) : (
        <div>
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} debt={debt} />
          ))}
        </div>
      )}
    </Card>
  )
}

/** Grouped Debts / Assets snapshot. `accounts` are already active-only. */
export default function AccountsSnapshot({ accounts }) {
  const debts = accounts
    .filter((a) => isDebt(a.type))
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    })
  const assets = accounts
    .filter((a) => !isDebt(a.type))
    .sort((a, b) => resolvedBalance(b) - resolvedBalance(a))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Group title="Debts" accounts={debts} debt emptyLabel="No debt accounts" />
      <Group title="Assets" accounts={assets} emptyLabel="No asset accounts" />
    </div>
  )
}
