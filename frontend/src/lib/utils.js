// All monetary values are integer cents end-to-end (API and storage).
// Dollars only exist at the display/input boundary.
export function formatMoney(cents) {
  if (cents == null) return '\u2014'
  const dollars = cents / 100
  const sign = dollars < 0 ? '-' : ''
  return sign + '$' + Math.abs(dollars).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Form-input boundary: dollar string <-> integer cents.
export function dollarsToCents(value) {
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? null : Math.round(parsed * 100)
}

export function centsToDollarInput(cents) {
  if (cents == null || cents === '') return ''
  return String(cents / 100)
}

// Compact money for chart axes: 12345600 cents -> "$123k", 4500 -> "$45".
export function compactMoney(cents) {
  if (cents == null) return ''
  const d = cents / 100
  const abs = Math.abs(d)
  const sign = d < 0 ? '-' : ''
  if (abs >= 1000) return sign + '$' + (abs / 1000).toFixed(abs >= 10000 ? 0 : 1) + 'k'
  return sign + '$' + abs.toFixed(0)
}

// Subtract whole months from an ISO date (YYYY-MM-DD), returning the same shape.
export function subtractMonths(dateStr, months) {
  const [y, m, day] = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, day))
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString().slice(0, 10)
}

// Relative timestamp for the activity feed; absolute form goes in a title tooltip.
export function timeAgo(iso) {
  if (!iso) return ''
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const mos = Math.floor(days / 30)
  if (mos < 12) return `${mos}mo ago`
  return `${Math.floor(mos / 12)}y ago`
}

export function formatRate(rate) {
  if (rate == null || rate === 0) return '\u2014'
  return rate.toFixed(2) + '%'
}

export function formatDate(dateStr) {
  if (!dateStr) return '\u2014'
  const datePart = dateStr.split('T')[0]
  const [year, month, day] = datePart.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[month - 1]} ${String(day).padStart(2, '0')}, ${year}`
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '\u2014'
  const d = new Date(dateStr)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const month = months[d.getUTCMonth()]
  const day = String(d.getUTCDate()).padStart(2, '0')
  const year = d.getUTCFullYear()
  let hours = d.getUTCHours()
  const minutes = String(d.getUTCMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12 || 12
  return `${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`
}

export function formatType(type) {
  if (type === '401k') return '401(k)'
  if (type === 'ira') return 'IRA'
  if (type === 'roth_ira') return 'Roth IRA'
  if (type === 'hsa') return 'HSA'
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function formatFrequency(f) {
  return {
    weekly: 'Weekly',
    biweekly: 'Biweekly',
    semimonthly: 'Semimonthly',
    monthly: 'Monthly',
    annual: 'Annual',
  }[f] || f
}

export function isDebt(type) {
  return ['credit_card', 'loan', 'mortgage', 'line_of_credit'].includes(type)
}

const MONTHLY_MULTIPLIERS = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2.0,
  monthly: 1.0,
  annual: 1 / 12,
}

export function monthlyEquiv(amount, frequency) {
  return amount * (MONTHLY_MULTIPLIERS[frequency] || 1)
}

export function nextPayday(lastPayDate, frequency) {
  if (!lastPayDate) return '\u2014'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let d = new Date(lastPayDate + 'T00:00:00')

  function advance(date) {
    const next = new Date(date)
    if (frequency === 'weekly') next.setDate(next.getDate() + 7)
    else if (frequency === 'biweekly') next.setDate(next.getDate() + 14)
    else if (frequency === 'semimonthly') next.setDate(next.getDate() + 15)
    else if (frequency === 'monthly') next.setMonth(next.getMonth() + 1)
    else if (frequency === 'annual') next.setFullYear(next.getFullYear() + 1)
    return next
  }

  while (d <= today) d = advance(d)
  return formatDate(d.toISOString().split('T')[0])
}

export function nextDueDate(dueDay, lastPaidDate) {
  if (dueDay == null) return '\u2014'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const y = today.getFullYear()
  const m = today.getMonth()
  // Try this month first
  let candidate = new Date(y, m, dueDay)
  if (candidate < today) {
    // Already passed this month, use next month
    candidate = new Date(y, m + 1, dueDay)
  }
  // If already paid for this billing period, push to next month.
  // The billing period for a candidate starts at the previous month's due day.
  // E.g. candidate = Apr 7 → period starts Mar 7. If paid on or after Mar 7,
  // the Apr 7 bill is covered → advance to May 7.
  if (lastPaidDate) {
    const paid = new Date(lastPaidDate + 'T00:00:00')
    const prevDue = new Date(candidate.getFullYear(), candidate.getMonth() - 1, dueDay)
    if (paid >= prevDue) {
      candidate = new Date(candidate.getFullYear(), candidate.getMonth() + 1, dueDay)
    }
  }
  return formatDate(candidate.toISOString().split('T')[0])
}
