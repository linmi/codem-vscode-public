// Reuse the caller's browser and preview service; all events below are fixture-only.
export default async function toolCoverageChecks(page) {
  const original = page.viewportSize()
  const errors = []
  const capture = error => errors.push(String(error))
  page.on('pageerror', capture)
  try {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({width: 1440, height: 900})
      await page.goto(`http://127.0.0.1:4318/?scenario=tools&theme=${theme}`)
      await page.getByRole('navigation', {name: '场景目录'}).getByRole('link', {name: '全部工具 · 真实参数投影', exact: true}).click()
      await page.getByText('src/auth.ts（第 12–48 行）', {exact: true}).waitFor()
      const tools = page.locator('.activityMessage[data-role="tool"]')
      if (await tools.count() !== 35) throw Error('Missing generic tool rows')
      if (await tools.locator('.toolOutput:visible').count() !== 35) throw Error('Not all tool details can expand')
      for (const text of ['第 12–14 行', '1024 字节', '持续协作', '安装成功后需重新加载 MCP 或开启新会话', 'assets/login.png', '24 条记录', '8 条记录']) {
        if (!await tools.getByText(text, {exact: true}).count()) throw Error(`Missing detail: ${text}`)
      }
      const mcp = tools.filter({has: page.locator('.activityTitle', {hasText: 'mcp__design__inspect_component'})})
      if ((await mcp.locator('.activityTitle').innerText()).split('mcp__design__inspect_component').length !== 2) throw Error('MCP title duplicated')
      if ((await tools.allTextContents()).join("\n").includes('private-')) throw Error('Raw inputs exposed')
      const command = tools.first()
      await command.locator('summary').click()
      await page.evaluate(() => {
        const command = demo.messages.find(message => message.label === 'run_bash')
        command.status = 'failed'; command.text = 'verification failed'; window.postMessage(demo, '*')
      })
      await command.locator('.activityTitle').getByText('执行命令失败 pnpm check', {exact: true}).waitFor()
      if (await command.locator('details').evaluate(node => node.open)) throw Error('Failure overrode user disclosure choice')
      await command.locator('summary').press('Enter')
      await command.getByText('verification failed', {exact: true}).waitFor()
      await page.evaluate(() => {
        const command = demo.messages.find(message => message.label === 'run_bash')
        command.status = 'running'; command.text = ''; window.postMessage(demo, '*')
      })
      await command.locator('.activityTitle').getByText('正在运行 pnpm check', {exact: true}).waitFor()
      if (!await command.locator('details').evaluate(node => node.open)) throw Error('Retry reset disclosure')
      await page.evaluate(() => {
        demo.messages.forEach(message => { if (message.role === 'tool') message.status = 'failed' })
        demo.messages.push({id:'failed-reasoning', role:'reasoning', label:'思考过程', status:'failed', summary:'分析执行结果', text:'推理中断详情'})
        window.postMessage(demo, '*')
      })
      await page.locator('.activityMessage[data-role="reasoning"][data-status="failed"]').waitFor()
      const failures = page.locator('.activityMessage[data-role="tool"][data-status="failed"]')
      const incorrect = await failures.evaluateAll(rows => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--vscode-errorForeground, #e02e2a)'; document.body.append(probe)
        const errorColor = getComputedStyle(probe).color; probe.remove()
        return rows.some(row => {
          const badge = row.querySelector('.activityStatus')
          return getComputedStyle(row.querySelector('.activityTitle')).color !== errorColor ||
            !badge.classList.contains('visuallyHidden') || getComputedStyle(badge).clipPath !== 'inset(50%)' || !badge.textContent.includes('失败')
        })
      })
      if (incorrect || await failures.count() !== 35) throw Error('Failed tools do not use red titles with accessible-only status')
      if (!await page.locator('.activityMessage[data-role="reasoning"] .activityStatus:not(.visuallyHidden)').count()) throw Error('Tool styling changed reasoning status')
      // A delivered result keeps the processing summary neutral and initially collapsed.
      while (await page.locator('.workGroup:not([open])').count()) await page.locator('.workGroup:not([open])').first().locator(':scope > summary').click()
      await command.locator('summary').hover()
      await page.screenshot({path: `output/playwright/toolFailures-${theme}.png`, animations: 'disabled'})
      await page.evaluate(() => {
        demo.messages.forEach(message => { if ('status' in message) message.status = 'completed' })
        window.postMessage(demo, '*')
      })
      await command.locator('.activityTitle').getByText('已运行 pnpm check', {exact: true}).waitFor({state: 'attached'})
      if (await page.locator('.activityMessage[data-status="failed"], .activityStatus.visuallyHidden').count()) throw Error('Completion retained failed presentation')
      while (await page.locator('.workGroup:not([open])').count()) await page.locator('.workGroup:not([open])').first().locator(':scope > summary').click()
      await page.screenshot({path: `output/playwright/toolCoverage-${theme}.png`, animations: 'disabled'})
      await page.setViewportSize({width: 380, height: 800})
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Tools overflow narrow view')
      await command.locator('summary').scrollIntoViewIfNeeded()
      await page.screenshot({path: `output/playwright/toolCoverage-${theme}-narrow.png`, animations: 'disabled'})
      await page.setViewportSize({width: 1440, height: 900})
      await page.getByRole('navigation', {name: '场景目录'}).getByRole('link', {name: '六类工具 · 参数与输出', exact: true}).click()
      if (await tools.count() !== 6) throw Error('Previous scene tool state survived switch')
      await page.reload()
      await tools.first().locator('.activityTitle').getByText('已运行 pnpm check', {exact: true}).waitFor()
    }
    if (errors.length) throw Error(errors.join('\n'))
    return 'TOOL_COVERAGE_OK: 35 samples, light/dark, wide/narrow, disclosure, failure/retry, scene switch/reload'
  } finally {
    page.off('pageerror', capture)
    if (original) await page.setViewportSize(original)
  }
}
