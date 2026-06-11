// Account types (and their per-type fields) now come from the backend registry:
// GET /api/meta/account-fields via useAccountFields().

export const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'semimonthly', label: 'Semimonthly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
]

export const DEBT_TYPES = ['credit_card', 'loan', 'mortgage', 'line_of_credit']
export const INVESTMENT_TYPES = ['401k', 'ira', 'roth_ira', 'brokerage', 'hsa']
