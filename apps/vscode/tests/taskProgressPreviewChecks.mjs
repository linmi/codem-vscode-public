// Reuses one preview page and the existing service; no Core or model calls.
export default async function taskProgressPreviewChecks(page) {
  const errors = []
  const capture = error => errors.push(String(error))
  page.on('pageerror', capture)
  const expect = (value, message) => { if (!value) throw Error(message) }
  const select = async name => {
    const link = page.getByRole('link', { name, exact: true })
    if (!await link.isVisible()) await page.getByRole('button', { name: '场景目录', exact: true }).click()
    await link.click()
  }
  try {
    await page.setViewportSize({ width: 1200, height: 1000 })
    await page.goto('http://127.0.0.1:4318/?scenario=tools')
    await select('任务清单 · 创建与进展')
    await page.locator('.taskProgressCard').first().waitFor()
    expect(await page.locator('.taskProgressCard').count() === 2, 'Missing create/update cards')
    expect(await page.locator('[data-task-state=completed]').count() === 1, 'Create success promoted pending work')
    const trigger = page.locator('.taskProgressDisclosure').last()
    await trigger.focus(); await page.keyboard.press('Enter')
    expect(await trigger.getAttribute('aria-expanded') === 'true', 'Keyboard cannot open details')
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: structuredClone(window.demo) })))
    expect(await trigger.getAttribute('aria-expanded') === 'true', 'Repeated snapshot collapsed details')
    await page.keyboard.press('Space')
    expect(await trigger.getAttribute('aria-expanded') === 'false', 'Keyboard cannot close details')
    await page.screenshot({ path: 'output/playwright/task-progress-light.png' })
    await page.getByRole('combobox', { name: '预览主题' }).click()
    await page.getByRole('option', { name: '深色', exact: true }).click()
    await page.setViewportSize({ width: 380, height: 900 })
    await page.locator('.taskProgressCard').last().waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow page overflows')
    expect(await page.locator('.taskProgressCard').evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth)), 'Card overflows')
    await page.screenshot({ path: 'output/playwright/task-progress-dark.png' })
    await select('任务清单 · 失败与未确认')
    expect(await page.locator('[data-task-state=completed]').count() === 0, 'Unconfirmed state shown as complete')
    expect(await page.locator('[data-task-state=unconfirmed]').count() === 5, 'Missing failure/cancellation states')
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    expect(await page.locator('.taskProgressCard[data-outcome=running]').count() === 0, 'Stop kept running call')
    const group = page.locator('.workGroup')
    if (!await group.evaluate(node => node.open)) await group.locator(':scope > summary').click()
    await page.locator('.taskProgressDisclosure').first().click()
    await page.evaluate(() => {
      const message = window.demo.messages[1]
      message.status = 'completed'
      window.dispatchEvent(new MessageEvent('message', { data: structuredClone(window.demo) }))
    })
    expect(await page.locator('[data-task-state=completed]').count() === 1, 'Confirmed retry did not update card')
    expect(await page.locator('.taskProgressDisclosure').first().getAttribute('aria-expanded') === 'true', 'Result update lost disclosure state')
    await page.getByRole('button', { name: '新建会话', exact: true }).click()
    expect(await page.locator('.taskProgressCard').count() === 0, 'Session reset leaked task cards')
    await select('任务清单 · 创建与进展')
    expect(await page.locator('.taskProgressDisclosure').first().getAttribute('aria-expanded') === 'false', 'Context switch reused stale disclosure')
    expect(errors.length === 0, errors.join('\n'))
    return 'Task cards: themes, 380px, keyboard, repeated snapshots, failure/refusal/stop/incomplete, update and session reset passed'
  } finally { page.off('pageerror', capture) }
}
