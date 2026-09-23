import { Link } from 'react-router-dom'
import { formatDate, formatMoney } from '../../lib/utils'
import Card, { CardBody } from '../ui/Card'

export default function SpendingBreakdown({ summary, loading }) {
  if (loading) return <p role="status" className="text-sm text-text-muted">Calculating cash available until payday…</p>
  if (!summary) return <p role="alert" className="text-sm text-warning">Could not load safe to spend. Refresh to try again.</p>
  return (
    <Card>
      <CardBody>
        <details>
          <summary className="cursor-pointer font-medium text-text focus-visible:outline-2 focus-visible:outline-accent rounded">
            {summary.complete ? 'How safe to spend is calculated' : 'Complete your safe-to-spend estimate'}
          </summary>
          <div className="mt-4 space-y-4 text-sm">
            {!summary.complete && (
              <ul className="list-disc pl-5 space-y-1 text-warning">
                {summary.issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            )}
            <p className="text-text-muted text-pretty">
              {summary.checking_label ? `Cash from ${summary.checking_label}. ` : ''}
              Payments due on payday are included because they may leave before payroll arrives.
              The incoming paycheck and bills due later are excluded. Living costs are estimated
              from your monthly budget over the remaining days.
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 tnum">
              <dt>Checking cash</dt><dd className="text-right">{formatMoney(summary.checking_balance)}</dd>
              <dt>− Required account payments</dt><dd className="text-right">{formatMoney(summary.account_payments)}</dd>
              <dt>− Unpaid expenses</dt><dd className="text-right">{formatMoney(summary.expense_payments)}</dd>
              <dt>− Living costs until payday</dt><dd className="text-right">{formatMoney(summary.living_costs)}</dd>
              <dt>− Cash cushion</dt><dd className="text-right">{formatMoney(summary.cash_cushion)}</dd>
              <dt className="font-semibold">Free to spend or save</dt><dd className="text-right font-semibold">{formatMoney(summary.available)}</dd>
            </dl>
            {summary.shortfall > 0 && <p className="text-debit">{formatMoney(summary.shortfall)} short of covering payments, living costs, and your cushion.</p>}
            {summary.bills.length > 0 && (
              <ul className="divide-y divide-border">
                {summary.bills.map((bill) => (
                  <li key={`${bill.kind}-${bill.id}-${bill.due}`} className="flex justify-between gap-4 py-2">
                    <span>{bill.name} <span className="text-text-muted">· {formatDate(bill.due)}{bill.overdue ? ' · Overdue' : ''}</span></span>
                    <span className="tnum">{formatMoney(bill.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-text-muted text-pretty">Keep balances and payments up to date. Link duplicate account payments in Expenses and exclude those bills from your living-cost budget.</p>
            <div className="flex flex-wrap gap-4">
              <Link className="text-accent underline" to="/settings">Edit living costs and cushion</Link>
              <Link className="text-accent underline" to="/income">Edit pay schedule</Link>
              <Link className="text-accent underline" to="/expenses">Review expenses</Link>
              <Link className="text-accent underline" to="/accounts">Review account payments</Link>
            </div>
          </div>
        </details>
      </CardBody>
    </Card>
  )
}
