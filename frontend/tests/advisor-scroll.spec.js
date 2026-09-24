import { test, expect } from '@playwright/test'

async function openConversation(page, { long = true } = {}) {
  await page.route('**/api/auth/me', route => route.fulfill({ json: { id: 1, email: 'test@example.com' } }))
  await page.addInitScript(({ long }) => {
    const answer = long
      ? Array.from({ length: 30 }, (_, i) => `Recommendation ${i + 1}: Set aside money for upcoming bills before adding to savings.`).join('\n\n')
      : 'Keep your rent money set aside.'
    const messages = [
      { role: 'user', content: 'Review my finances.' },
      { role: 'assistant', content: 'Start with upcoming bills.' },
      { role: 'user', content: 'Tell me more.' },
      { role: 'assistant', content: answer },
    ]
    localStorage.setItem('advisorChat:1', JSON.stringify({ thread: messages, apiHistory: messages, expiresAt: Date.now() + 60_000 }))
  }, { long })
  await page.goto('/chat')
  await expect(page.getByRole('log')).toBeVisible()
}

async function pointAtAnswer(page) {
  const answer = page.getByRole('log')
  await answer.evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150))
  const box = await answer.boundingBox()
  await page.mouse.move(box.x + box.width / 2, Math.max(box.y, 100) + 40)
}

for (const width of [1280, 390]) {
  test(`page scrolls both ways over a long advisor answer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openConversation(page)
    await pointAtAnswer(page)
    const before = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 300)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 100)
    const after = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, -200)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(after - 50)
  })
}

test('a short answer does not trap page scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await openConversation(page, { long: false })
  await pointAtAnswer(page)
  const before = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, -200)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before - 50)
})

test('expanded history scrolls internally and hands scrolling back to the page at its boundaries', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openConversation(page)
  await page.getByRole('button', { name: 'Show this conversation' }).click()
  await pointAtAnswer(page)
  const answer = page.getByRole('log')
  const before = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => answer.evaluate(el => el.scrollTop)).toBeGreaterThan(100)
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  await answer.evaluate(el => { el.scrollTop = el.scrollHeight })
  await page.mouse.wheel(0, 250)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
  await pointAtAnswer(page)
  await answer.evaluate(el => { el.scrollTop = 0 })
  const beforeUp = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, -200)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(beforeUp)
})
