import { test, expect } from '@playwright/test'

const accountTypes = ['checking', 'credit_card'].map((value) => ({
  value,
  label: value === 'checking' ? 'Checking' : 'Credit Card',
  fields: [{ name: 'balance', label: 'Balance', kind: 'money', required: true }],
}))

const cases = [
  { path: 'accounts', label: 'Account', submit: 'Create Account', type: 'checking', money: 'balance' },
  { path: 'accounts', label: 'Account', submit: 'Create Account', type: 'credit_card', money: 'balance' },
  { path: 'expenses', label: 'Expense', submit: 'Add Expense', money: 'amount' },
  { path: 'income', label: 'Income', submit: 'Create Income', money: 'amount' },
]

// Exercise the actual pages and native submit buttons. All API traffic is mocked:
// no credentials, personal financial data, or paid LLM calls are needed.
for (const scenario of cases) {
  test(`${scenario.path} ${scenario.type || ''}: create and edit send requests and refresh the list`, async ({ page }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const writes = []
    let items = []
    const endpoint = `/api/${scenario.path}`

    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path === endpoint && request.method() === 'POST') {
        const body = request.postDataJSON()
        writes.push({ method: 'POST', path, body })
        const item = { id: 1, is_active: 1, ...body }
        items.push(item)
        return route.fulfill({ json: item })
      }
      if (path === `${endpoint}/1` && request.method() === 'PUT') {
        const body = request.postDataJSON()
        writes.push({ method: 'PUT', path, body })
        items = [{ ...items[0], ...body }]
        return route.fulfill({ json: items[0] })
      }
      if (request.method() === 'GET') {
        if (path === endpoint) return route.fulfill({ json: items })
        if (path === '/api/auth/me') return route.fulfill({ json: { id: 1, email: 'test@example.com' } })
        if (path === '/api/meta/account-fields') return route.fulfill({ json: { types: accountTypes } })
        if (path === '/api/settings') return route.fulfill({ json: { min_checking: 0 } })
        if (path === '/api/accounts') return route.fulfill({ json: [] })
      }
      throw new Error(`Unexpected API request: ${request.method()} ${path}`)
    })

    await page.goto(`/${scenario.path}`)
    await page.getByRole('button', { name: `Add ${scenario.label}`, exact: true }).first().click()
    const form = page.locator('form')
    await form.locator('input').first().fill('Test entry')
    if (scenario.type) await form.locator('select').selectOption(scenario.type)
    await form.locator('input[type="number"]').first().fill('1234.56')
    await form.getByRole('button', { name: scenario.submit, exact: true }).click()

    await expect(page.getByText(`${scenario.label} created`, { exact: true })).toBeVisible()
    await expect(form).toHaveCount(0)
    await expect(page.locator('tbody')).toContainText('Test entry')
    expect(writes).toEqual([{
      method: 'POST', path: endpoint,
      body: expect.objectContaining({ name: 'Test entry', [scenario.money]: 123456 }),
    }])
    if (scenario.type) expect(writes[0].body.type).toBe(scenario.type)

    await page.locator('tbody button').click()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await form.locator('input').first().fill('Updated entry')
    await form.locator('input[type="number"]').first().fill('2345.67')
    await form.getByRole('button', { name: 'Save Changes', exact: true }).click()

    await expect(page.getByText(`${scenario.label} updated`, { exact: true })).toBeVisible()
    await expect(form).toHaveCount(0)
    await expect(page.locator('tbody')).toContainText('Updated entry')
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual({
      method: 'PUT', path: `${endpoint}/1`,
      body: expect.objectContaining({ name: 'Updated entry', [scenario.money]: 234567 }),
    })
    if (scenario.type) expect(writes[1].body).not.toHaveProperty('type')
    expect(errors).toEqual([])
  })
}
