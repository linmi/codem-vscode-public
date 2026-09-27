// Run against the existing preview browser, never launch another browser here.
export default async function messageQueueChecks(page) {
  const errors = []
  const collect = message => { if (message.type() === 'error') errors.push(message.text()) }
  page.on('console', collect)
  const prompt = page.locator('#prompt')
  const queue = page.getByRole('region', { name: '排队消息', exact: true })
  const queuedTexts = () => queue.locator('.composerQueueText').allTextContents()
  const actions = type => page.evaluate(kind => window.viewActions.filter(action => action.type === kind), type)
  try {
    for (const [theme, width] of [['light', 1440], ['dark', 380]]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`http://127.0.0.1:4318/?scenario=tools&theme=${theme}`)
      if (await page.evaluate(() => window.demo.phase) !== 'running') throw Error('Fixture is not running')
      if (await queue.count()) throw Error('Empty queue rendered')
      // Enter while running queues instead of steering.
      if (await prompt.getAttribute('placeholder') !== '输入下一条消息，本轮完成后发送…') throw Error('Running placeholder does not say the message is queued')
      await prompt.fill('先补上测试')
      await prompt.press('Enter')
      await queue.waitFor()
      if (await prompt.inputValue() !== '') throw Error('Accepted queue kept the draft')
      await prompt.fill('再更新文档')
      await page.getByRole('button', { name: '加入排队', exact: true }).click()
      await queue.getByText('排队中 2 条', { exact: true }).waitFor()
      if ((await actions('steer')).length) throw Error('Queueing sent a steer')
      const queued = await actions('queueMessage')
      if (queued.length !== 2 || queued.some(action => action.threadId !== 'preview')) throw Error('Queue not bound to the current thread')
      // Edit: Escape keeps the original, save applies the change.
      await page.getByRole('button', { name: '编辑第 1 条排队消息', exact: true }).click()
      const editor = page.getByRole('textbox', { name: '编辑第 1 条排队消息', exact: true })
      if (!await editor.evaluate(node => node === document.activeElement)) throw Error('Editor not focused')
      await editor.fill('丢弃的修改')
      await editor.press('Escape')
      if ((await queuedTexts())[0] !== '先补上测试') throw Error('Escape changed the queued message')
      if (await page.getByRole('dialog').count()) throw Error('Escape leaked to another surface')
      await page.getByRole('button', { name: '编辑第 1 条排队消息', exact: true }).click()
      await editor.fill('先补上单元测试')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await queue.getByText('先补上单元测试', { exact: true }).waitFor()
      await page.screenshot({ animations: 'disabled', path: `output/playwright/messageQueue-${theme}.png` })
      // Remove the second item.
      await page.getByRole('button', { name: '移除第 2 条排队消息', exact: true }).click()
      await queue.getByText('排队中 1 条', { exact: true }).waitFor()
      if (JSON.stringify(await queuedTexts()) !== JSON.stringify(['先补上单元测试'])) throw Error('Remove left the wrong item')
      // Stopping pauses the queue; nothing is sent until the user continues.
      await page.getByRole('button', { name: '停止生成', exact: true }).click()
      await queue.getByText('上一轮已停止或失败，排队消息不会自动发送。', { exact: true }).waitFor()
      if ((await actions('resumeQueue')).length) throw Error('Queue resumed on its own')
      if (await page.evaluate(() => window.demo.messages.some(message => message.text === '先补上单元测试'))) throw Error('Paused queue was sent')
      await page.screenshot({ animations: 'disabled', path: `output/playwright/messageQueuePaused-${theme}.png` })
      await page.getByRole('button', { name: '继续发送', exact: true }).click()
      await queue.waitFor({ state: 'detached' })
      if (!await page.evaluate(() => window.demo.messages.some(message => message.role === 'user' && message.text === '先补上单元测试'))) throw Error('Continue did not send the queued message')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (overflow > 0) throw Error(`Horizontal overflow ${overflow}px`)
    }
    if (errors.length) throw Error(`Console errors: ${errors.join(' | ')}`)
  } finally {
    page.off('console', collect)
  }
}
