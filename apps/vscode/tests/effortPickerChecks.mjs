export default async function effortPickerChecks(page) {
  for (const width of [320, 430, 1000]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('http://127.0.0.1:4318/?scenario=disconnected')
    const trigger = page.locator('#selectEffort')
    for (const [effort, bars] of [['low', 1], ['medium', 2], ['high', 3], ['xhigh', 4]]) {
      const before = await page.evaluate(() => window.viewActions.length)
      await trigger.click()
      const menu = page.locator('.effortMenu')
      await menu.waitFor()
      if (await menu.getByRole('option').count() !== 4) throw new Error('Missing effort choices')
      if (await page.evaluate(() => window.viewActions.length) !== before) throw new Error('Opening effort menu contacted Host')
      const geometry = await menu.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, overflow: document.documentElement.scrollWidth > innerWidth } })
      if (geometry.left < 11 || geometry.right > width - 11 || geometry.overflow) throw new Error(JSON.stringify(geometry))
      await menu.getByRole('option', { name: effort === 'medium' ? 'medium 默认' : effort, exact: true }).click()
      await menu.waitFor({ state: 'hidden' })
      if (await trigger.getAttribute('aria-label') !== `思考强度：${effort}` || await trigger.locator('[data-active="true"]').count() !== bars) throw new Error('Effort and signal disagree')
      if (await page.evaluate(() => window.demo.phase) !== 'disconnected') throw new Error('Offline selection started a connection')
    }
    const before = await page.evaluate(() => window.viewActions.length)
    await trigger.press('ArrowDown')
    await page.locator('.effortMenu').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.effortMenu').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.id === 'selectEffort')
    if (await page.evaluate(() => window.viewActions.length) !== before) throw new Error('Cancellation changed settings')
    if (await page.evaluate(() => window.viewActions.some(action => action.type === 'connect' || action.type === 'selectEffort' || action.type === 'panelReply'))) throw new Error('Obsolete effort flow')
  }
  await page.goto('http://127.0.0.1:4318/?scenario=waitingForHost')
  await page.getByRole('combobox', { name: '思考强度：medium', exact: true }).click()
  await page.locator('.effortMenu').waitFor()
  await page.keyboard.press('Escape')
  for (const theme of ['light', 'dark']) {
    await page.goto(`http://127.0.0.1:4318/?scenario=effort&theme=${theme}`)
    await page.locator('.effortMenu').waitFor()
    await page.screenshot({ path: `output/playwright/effortPicker${theme}.png` })
  }
  return 'LOCAL_EFFORT_PICKER_OK'
}
