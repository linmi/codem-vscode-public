// Reuse one browser page. The preview models Core-confirmed stops; no live requests.
export default async function turnStatusPreviewChecks(page) {
  const errors = []
  const capture = error => errors.push(String(error))
  page.on('pageerror', capture)
  const expect = (value, message) => { if (!value) throw Error(message) }
  try {
    for (const [theme, width] of [['light', 1200], ['dark', 380]]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`http://127.0.0.1:4318/?scenario=stoppedTurn&theme=${theme}`)
      const note = page.locator('.turnStatus').first()
      await note.waitFor()
      expect(!await page.locator('#notice').isVisible(), 'Stopped turn still uses composer warning')
      expect(await note.innerText() === '已停止生成。', 'Missing stopped text')
      expect(await note.evaluate(node => {
        const style = getComputedStyle(node)
        return node.parentElement.id === 'messages' && node.previousElementSibling.classList.contains('workGroup') && style.borderTopWidth === '0px' && style.backgroundColor === 'rgba(0, 0, 0, 0)'
      }), 'Stopped text is framed or detached from the turn')
      const group = page.locator('.workGroup')
      expect(!await group.evaluate(node => node.open), 'Stopped work starts expanded')
      await group.locator('summary').first().click()
      expect(await note.isVisible(), 'Opening work hides stopped status')
      const noteBounds = await note.boundingBox(), groupBounds = await group.boundingBox()
      expect(noteBounds.y >= groupBounds.y + groupBounds.height, 'Stopped status should be below expanded work')
      expect(await note.locator('button').count() === 0, 'Stopped status has message actions')
      await page.screenshot({ animations: 'disabled', path: `output/playwright/turn-status-${theme}.png` })
      await group.locator('summary').first().click()
      expect(await note.isVisible(), 'Collapsing work hides stopped status')
      await page.locator('#prompt').fill('创建三个任务吧')
      await page.getByRole('button', { name: '发送消息', exact: true }).click()
      await page.locator('#workingRow').waitFor()
      expect(!await page.locator('#notice').isVisible(), 'Old stop appears as current warning after sending')
      expect(await page.locator('.turnStatus').count() === 1, 'Sending duplicated the previous stop')
      expect(await note.evaluate(node => node.nextElementSibling?.getAttribute('data-role') === 'user'), 'Stop moved below next user message')
      await page.getByRole('button', { name: '停止生成', exact: true }).click()
      await page.locator('.turnStatus').nth(1).waitFor()
      expect(!await page.locator('#notice').isVisible(), 'Second stop created a composer warning')
      await page.reload(); await note.waitFor()
      expect(await page.locator('.turnStatus').count() === 1, 'Reload duplicated stopped status')
      await page.evaluate(() => { window.demo.notice = '连接异常，请重试。'; window.dispatchEvent(new MessageEvent('message', { data: structuredClone(window.demo) })) })
      await page.locator('footer #notice').getByText('连接异常，请重试。', { exact: true }).waitFor()
      await page.getByRole('button', { name: '新建会话', exact: true }).click()
      await note.waitFor({ state: 'detached' })
      expect(!await page.locator('#notice').isVisible(), 'New session retained notice')
    }
    expect(errors.length === 0, errors.join('\n'))
    return 'TURN_STATUS_OK: placement, no border, fold/unfold, resend feedback, repeated stop, reload, warnings and cleanup'
  } finally { page.off('pageerror', capture) }
}
