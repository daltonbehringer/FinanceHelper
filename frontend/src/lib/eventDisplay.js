import { formatMoney } from './utils'

/* Pure helpers for turning raw event rows into feed-ready shapes. */

const TYPE_LABEL = {
  account: 'Account',
  snapshot: 'Account',
  recurring_expense: 'Expense',
  recurring_income: 'Income',
  user_settings: 'Settings',
}

const MONEY_FIELDS = new Set([
  'balance', 'payment_made', 'amount', 'minimum_payment', 'credit_limit', 'min_checking',
])

// Lower number = more "primary" when one user action spans several events.
const ACTION_PRIORITY = { pay: 0, create: 1, delete: 2, restore: 3, update: 4 }

/** Group events (already id-desc) by correlation_id, preserving feed order.
    Events without a correlation_id each stand alone. Regroup over the full
    accumulated list so a group split across pages still merges. */
export function groupEvents(events) {
  const groups = []
  const byCorr = new Map()
  for (const ev of events) {
    if (!ev.correlation_id) {
      groups.push({ key: `solo-${ev.id}`, events: [ev] })
      continue
    }
    const existing = byCorr.get(ev.correlation_id)
    if (existing) {
      existing.events.push(ev)
    } else {
      const g = { key: ev.correlation_id, events: [ev] }
      byCorr.set(ev.correlation_id, g)
      groups.push(g)
    }
  }
  return groups
}

export function primaryEvent(group) {
  return [...group.events].sort((a, b) =>
    (ACTION_PRIORITY[a.action] ?? 9) - (ACTION_PRIORITY[b.action] ?? 9) || a.id - b.id
  )[0]
}

export function actionLabel(ev) {
  const { action: a, entity_type: t } = ev
  if (a === 'pay') return 'Paid'
  if (a === 'create' && t === 'snapshot') return 'Balance update'
  if (a === 'create' && t === 'account') return 'Account added'
  if (a === 'create' && t === 'recurring_expense') return 'Expense added'
  if (a === 'create' && t === 'recurring_income') return 'Income added'
  if (a === 'delete' && t === 'snapshot') return 'Balance reverted'
  if (a === 'delete') return 'Removed'
  if (a === 'restore') return 'Balance restored'
  if (a === 'update') return 'Updated'
  return a
}

export function entityName(ev) {
  if (ev.entity_name) return ev.entity_name
  const label = TYPE_LABEL[ev.entity_type] || ev.entity_type
  return `${label} #${ev.entity_id}`
}

/** Newest created_at across a group, for the headline timestamp. */
export function groupTime(group) {
  return group.events.reduce((max, e) => (e.created_at > max ? e.created_at : max), '')
}

export function isLlm(group) {
  return group.events.some(e => e.source === 'llm')
}

function fmtField(field, value) {
  if (value == null) return '—'
  if (MONEY_FIELDS.has(field) && typeof value === 'number') return formatMoney(value)
  if (Array.isArray(value)) return value.join(', ') || '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Normalize a `changes` payload into renderable rows for either shape:
    `{field:{old,new}}` (updates) or a flat object (create/delete snapshots). */
export function changeRows(changes) {
  if (!changes || typeof changes !== 'object') return []
  const rows = []
  for (const [field, val] of Object.entries(changes)) {
    if (val && typeof val === 'object' && 'old' in val && 'new' in val) {
      rows.push({ field, old: fmtField(field, val.old), next: fmtField(field, val.new) })
    } else {
      rows.push({ field, value: fmtField(field, val) })
    }
  }
  return rows
}

export function prettyField(field) {
  return field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
