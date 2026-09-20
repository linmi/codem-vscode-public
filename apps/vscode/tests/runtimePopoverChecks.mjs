// Reuse the caller's browser/page. Fixtures never contact Core.
export default async function runtimePopoverChecks(page) {
  const errors = []
  const capture = error => errors.push(String(error))
  page.on('pageerror', capture)
  const results = []
  try {
    for (const [width, height, theme] of [[1440, 900, 'light'], [380, 640, 'dark'], [320, 480, 'light']]) {
      await page.setViewportSize({width, height})
      await page.goto(`http://127.0.0.1:4318/?scenario=runtimeDetails&theme=${theme}`)
      const popover = page.locator('.runtimeDetailsPopover')
      const trigger = page.locator('#runtimeDetails')
      await popover.waitFor()
      await page.getByRole('dialog', {name:'运行详情',exact:true}).waitFor()
      await page.getByRole('region', {name:'Token 用量',exact:true}).getByText('18,240', {exact:true}).waitFor()
      const bounds = await popover.evaluate(node => {
        const box = node.getBoundingClientRect(), anchor = document.querySelector('#runtimeDetails').getBoundingClientRect()
        return {left:box.left, right:box.right, top:box.top, bottom:box.bottom, anchorTop:anchor.top, width:box.width, modal:node.getAttribute('aria-modal'), lock:document.body.hasAttribute('data-scroll-locked'), horizontalOverflow:document.documentElement.scrollWidth > innerWidth}
      })
      if (bounds.width > 320 || bounds.left < 11 || bounds.right > width - 11 || bounds.top < 11 || Math.abs(bounds.anchorTop - bounds.bottom - 8) > 2) throw Error(`Popover is not anchored within viewport: ${JSON.stringify(bounds)}`)
      if (bounds.modal === 'true' || bounds.lock || bounds.horizontalOverflow || await page.locator('[data-slot="dialog-overlay"]').count()) throw Error('Runtime info still blocks or shifts the page')
      const openLayout = await page.locator('.composer').boundingBox()
      await page.screenshot({animations:'disabled',path:`output/playwright/runtimePopover-${theme}-${width}.png`})
      await page.keyboard.press('Escape')
      await popover.waitFor({state:'hidden'})
      if (!await trigger.evaluate(node => node === document.activeElement)) throw Error('Escape did not restore trigger focus')
      if (JSON.stringify(openLayout) !== JSON.stringify(await page.locator('.composer').boundingBox())) throw Error('Popover changed composer bounds')
      await trigger.press('Enter')
      await popover.waitFor()
      await trigger.click()
      await popover.waitFor({state:'hidden'})
      await trigger.click()
      await popover.waitFor()
      // On narrow sidebars the anchored panel overlaps the composer; dismiss
      // through the exposed page margin before checking that input remains usable.
      await popover.screenshot({animations:'disabled'})
      await page.mouse.click(4, 4)
      await popover.waitFor({state:'hidden'})
      await page.locator('#prompt').click()
      if (!await page.locator('#prompt').evaluate(node => node === document.activeElement)) throw Error('Outside click should keep focus on the input')
      await trigger.click()
      await popover.waitFor()
      await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data:{type:'editorSettings',sendKey:'modEnter'}})))
      await page.getByRole('region', {name:'快捷键',exact:true}).getByText('Ctrl / Cmd + Enter', {exact:true}).scrollIntoViewIfNeeded()
      await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data:{...window.demo,capabilities:{...window.demo.capabilities,usage:{input:0,output:79,cacheRead:null,cacheWrite:0}}}})))
      await page.getByRole('region', {name:'Token 用量',exact:true}).getByText('79', {exact:true}).waitFor()
      await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data:{...window.demo,threadId:'next-runtime-thread'}})))
      await popover.waitFor({state:'hidden'})
      results.push({width, height, theme, ...bounds})
    }
    await page.goto('http://127.0.0.1:4318/?scenario=welcome&theme=dark')
    await page.locator('#runtimeDetails').click()
    await page.getByText('暂无用量数据', {exact:true}).waitFor()
    await page.reload()
    await page.locator('#runtimeDetails[data-state="closed"]').waitFor()
    if (await page.locator('.runtimeDetailsPopover').count()) throw Error('Reload should start closed')
    if (errors.length) throw Error(errors.join('\n'))
    return {status:'RUNTIME_POPOVER_OK', results}
  } finally { page.off('pageerror', capture) }
}
