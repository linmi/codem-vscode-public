// Reuse an existing preview browser/page; this check never launches a browser.
export default async function liveSnapshotChecks(page) {
  const errors = []
  const collect = message => { if (message.type() === 'error') errors.push(message.text()) }
  page.on('console', collect)
  const open = async () => {
    await page.locator('#prompt').fill('/')
    await page.getByRole('combobox', { name: '搜索会话命令', exact: true }).fill('catalog')
    await page.locator('[cmdk-item][data-value="catalog"]').click()
    await page.getByRole('combobox', { name: '目录类型' }).click()
    await page.getByRole('option', { name: '实时线程快照', exact: true }).click()
  }
  const publish = patch => page.evaluate(patch => {
    const state = window.demo
    Object.assign(state.sessionTools.catalog, patch)
    state.sessionTools.busy = patch.loading ? 'catalog:live' : null
    window.dispatchEvent(new MessageEvent('message', { data: structuredClone(state) }))
  }, patch)
  try {
    for (const [theme, width] of [['light', 1440], ['dark', 380]]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`http://127.0.0.1:4318/?scenario=conversation&theme=${theme}`)
      await open()
      if (await page.getByRole('button', { name: /^加载更多/ }).count()) throw Error('Pagination visible before Host response')
      if (await page.evaluate(() => window.viewActions.some(action => action.type === 'loadCatalog'))) throw Error('Opening snapshot fetched data')
      await page.getByRole('combobox', { name: '目录类型' }).click()
      await page.getByRole('option', { name: '实时线程快照', exact: true }).waitFor()
      await page.screenshot({ path: `output/playwright/liveSnapshot-menu-${theme}.png`, animations: 'disabled' })
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '刷新目录', exact: true }).click()
      await page.getByText('轮次 · 已加载 1 / 3', { exact: true }).waitFor()
      await page.getByRole('button', { name: '加载更多轮次', exact: true }).click()
      await page.getByText('轮次 · 已加载 2 / 3', { exact: true }).waitFor()
      await page.getByText('Item · 已加载 1 / 3', { exact: true }).waitFor()
      await page.getByRole('button', { name: '加载更多轮次', exact: true }).click()
      await page.getByText('轮次 · 已加载 3 / 3', { exact: true }).waitFor()
      if (await page.getByRole('button', { name: '加载更多轮次', exact: true }).count()) throw Error('Exhausted page remains available')
      await publish({ loading: 'items' })
      await page.getByText('正在加载Item…', { exact: true }).waitFor()
      if (await page.getByRole('button', { name: '加载更多Item', exact: true }).isEnabled()) throw Error('Duplicate paging allowed while busy')
      await page.getByRole('button', { name: '取消加载', exact: true }).click()
      await page.getByRole('button', { name: '取消加载', exact: true }).waitFor({ state: 'hidden' })
      await publish({ loading: null, error: '快照加载失败，已有内容已保留；可重试或刷新。' })
      await page.getByRole('alert').filter({ hasText: '快照加载失败' }).waitFor()
      await page.getByText('轮次 · 已加载 3 / 3', { exact: true }).waitFor()
      await page.getByRole('button', { name: '加载更多Item', exact: true }).click()
      await page.getByText('Item · 已加载 2 / 3', { exact: true }).waitFor()
      await publish({ stale: true, error: null, loading: null })
      await page.getByText('快照已变化，请刷新后继续翻页。', { exact: true }).waitFor()
      if (await page.getByRole('button', { name: /^加载更多/ }).count()) throw Error('Stale snapshot can be paginated')
      await page.getByRole('button', { name: '刷新目录', exact: true }).click()
      await page.getByText('轮次 · 已加载 1 / 3', { exact: true }).waitFor()
      await page.screenshot({ path: `output/playwright/liveSnapshot-${theme}.png`, animations: 'disabled' })
      const dialog = page.getByRole('dialog')
      if (await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1)) throw Error('Snapshot overflows dialog')
      await publish({ loading: 'items' })
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      const cancels = await page.evaluate(() => window.viewActions.filter(action => action.type === 'cancelLiveSnapshot'))
      if (cancels.length !== 2) throw Error('Closing dialog did not cancel its request')
      await page.reload()
      await open()
      if (await page.getByRole('button', { name: /^加载更多/ }).count()) throw Error('Reload retained obsolete pagination')
      await page.getByRole('button', { name: '关闭', exact: true }).click()
    }
    if (errors.length) throw Error(errors.join('\n'))
    return 'LIVE_SNAPSHOT_UI_OK: independent pages, loading/cancel, failure retention, stale refresh, close/reload; light 1440px and dark 380px'
  } finally { page.off('console', collect) }
}
