import { test, expect } from '@playwright/test'

const plan = {
  as_of: '2026-06-11',
  complete: true,
  issues: [],
  available: 203043,
  projected_balance: 203043,
  shortfall: 0,
  checking_balance: 386542,
  checking_label: 'Everyday checking',
  next_payday: { date: '2026-06-20', amount: 285000, name: 'Salary' },
  account_payments: 14500,
  expense_payments: 15999,
  living_costs: 28000,
  cash_cushion: 50000,
  held_back: 75000,
  bills: [
    {
      kind: 'account',
      id: 4,
      name: 'Chase Sapphire',
      due: '2026-06-14',
      amount: 14500,
      reserved: 14500,
      reserve_stage: 'due',
      overdue: false,
    },
    {
      kind: 'expense',
      id: 1,
      name: 'Electric & water',
      due: '2026-06-16',
      amount: 8000,
      reserved: 8000,
      reserve_stage: 'due',
      overdue: false,
    },
    {
      kind: 'expense',
      id: 2,
      name: 'Internet',
      due: '2026-06-18',
      amount: 7999,
      reserved: 7999,
      reserve_stage: 'due',
      overdue: false,
    },
    {
      kind: 'expense',
      id: 3,
      name: 'Rent',
      due: '2026-07-01',
      amount: 150000,
      reserved: 75000,
      reserve_stage: 'half',
      overdue: false,
    },
  ],
}
const accounts = [
  {
    id: 1,
    name: 'Everyday checking',
    type: 'checking',
    current_balance: 386542,
  },
  {
    id: 2,
    name: 'Emergency savings',
    type: 'savings',
    current_balance: 1200000,
  },
  { id: 3, name: 'Investments', type: 'investment', current_balance: 2600000 },
  {
    id: 4,
    name: 'Chase Sapphire',
    type: 'credit_card',
    balance: 300000,
    current_balance: 218000,
  },
  { id: 5, name: 'Car loan', type: 'loan', current_balance: 1450000 },
]

async function mockOverview(page, summary = plan, accountData = accounts) {
  const requested = []
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    requested.push(path)
    if (path === '/api/ai/chat') return route.fulfill({ contentType: 'text/event-stream', body: 'event: text\ndata: {"text":"Your recommendations."}\n\nevent: done\ndata: {}\n\n' })
    if (path === '/api/dashboard/safe-to-spend' && summary === null)
      return route.fulfill({ status: 503, json: {} })
    const data =
      path === '/api/auth/me'
        ? { id: 1, email: 'test@example.com' }
        : path === '/api/accounts'
          ? accountData
          : path === '/api/dashboard/safe-to-spend'
            ? summary
            : path === '/api/budget/spending-money'
              ? { has_budget: true, spending_money: 128000, issues: [] }
              : []
    await route.fulfill({ json: data })
  })
  return requested
}

test('overview uses current balances without history or AI requests', async ({
  page,
}) => {
  const requested = await mockOverview(page)
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'The overview.' })
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Safe to spend' })
  ).toContainText('$2,030.43')
  await expect(page.getByText('In 9 days', { exact: true })).toBeVisible()
  await expect(page.locator('.overview-allocation-legend')).toContainText(
    '$750.00'
  )
  const balance = page.getByRole('region', { name: 'Balance sheet.' })
  await expect(balance).toContainText('$25,185.42')
  await expect(balance).toContainText('$16,680.00')
  const coming = page.getByRole('region', { name: 'Coming up.' })
  await expect(coming.getByRole('listitem')).toHaveCount(4)
  await expect(
    coming.getByRole('link').filter({ hasText: 'Rent' })
  ).toContainText('Early hold')
  await expect(
    coming.getByRole('link').filter({ hasText: 'Rent' })
  ).toContainText('$750.00')
  expect(requested).not.toContain('/api/history/net-worth')
  expect(requested.some((path) => path.startsWith('/api/ai/'))).toBe(false)
  await page.getByRole('link', { name: 'See your cash plan' }).click()
  await expect(page).toHaveURL(/#cash-plan$/)
  await page.locator('summary').click()
  await expect(
    page.getByRole('link', { name: 'Edit living costs and cushion' })
  ).toBeVisible()
  await page.locator('.overview-advisor').click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByRole('log')).toContainText('Your recommendations.')
  expect(requested.filter(path => path === '/api/ai/chat')).toHaveLength(1)
})

test('shortfall and overdue bills receive explicit labels', async ({
  page,
}) => {
  await mockOverview(page, {
    ...plan,
    checking_balance: 10000,
    available: 0,
    projected_balance: -173499,
    shortfall: 173499,
    bills: [
      { ...plan.bills[0], due: '2026-06-10', overdue: true },
      ...plan.bills.slice(1),
    ],
  })
  await page.goto('/')
  await expect(
    page.getByRole('region', { name: 'Safe to spend' })
  ).toContainText('Needs attention')
  await expect(
    page.getByText('$1,734.99 short before Jun 20, 2026')
  ).toBeVisible()
  await expect(
    page.getByText(
      'Your plan needs $1,734.99 more than your checking cash. The bar shows the total needed.'
    )
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Coming up.' })).toContainText(
    'Overdue'
  )
})

test('missing plan does not claim covered payments or free money', async ({
  page,
}) => {
  await mockOverview(page, null, [])
  await page.goto('/')
  await expect(
    page.getByRole('region', { name: 'Safe to spend' })
  ).toContainText('Unable to load')
  await expect(
    page.getByText('Your plan is covered', { exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Coming up.' })).toContainText(
    'could not be loaded'
  )
  await expect(
    page.getByRole('region', { name: 'Balance sheet.' })
  ).toContainText('Add accounts')
  await expect(page.locator('.overview-allocation-bar')).toHaveCount(0)
})

test('zero cash and zero obligations render an honest empty plan', async ({
  page,
}) => {
  await mockOverview(page, {
    ...plan,
    available: 0,
    projected_balance: 0,
    checking_balance: 0,
    account_payments: 0,
    expense_payments: 0,
    living_costs: 0,
    cash_cushion: 0,
    held_back: 0,
    bills: [],
  })
  await page.goto('/')
  await expect(
    page.getByRole('region', { name: 'Safe to spend' })
  ).toContainText('$0.00')
  await expect(
    page.getByText('No payments reserved this period.')
  ).toBeVisible()
  await expect(page.locator('.overview-allocation-bar span')).toHaveCount(0)
})

for (const width of [390, 768, 1440]) {
  test(`overview works at ${width}px with the original menu and no overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await mockOverview(page)
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'The overview.' })
    ).toBeVisible()
    await expect(page.getByRole('region', { name: 'Coming up.' })).toBeVisible()
    await page.locator('summary').click()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
    await expect(page.locator('aside nav a')).toHaveText([
      'Dashboard',
      'Accounts',
      'Expenses',
      'Income',
      'Chat',
      'History',
      'Settings',
    ])
    expect(errors).toEqual([])
  })
}
