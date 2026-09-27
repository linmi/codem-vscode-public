export default async function composerMenuChecks(page) {
  await catalogStyleChecks(page)
  await fixedMenuStyleChecks(page)
  await permissionCommandChecks(page)
  await page.goto('http://127.0.0.1:4318/?scenario=disconnected')
  for (const [id, menu] of [['addAttachment', '.composerChoiceMenu'], ['selectPermission', '.composerChoiceMenu'], ['selectWorkMode', '.composerChoiceMenu'], ['selectModel', '.composerCatalogMenu'], ['selectSpace', '.composerCatalogMenu']]) {
    const before = await page.evaluate(() => window.viewActions.length)
    await page.locator(`#${id}`).click()
    await page.locator(menu).waitFor()
    if (await page.evaluate(() => window.viewActions.length) !== before) throw new Error(`${id} contacted Host just to open`)
    if (await page.evaluate(() => window.demo.phase) !== 'disconnected') throw new Error(`${id} woke Core`)
    await page.keyboard.press('Escape')
    await page.locator(menu).waitFor({ state: 'hidden' })
    if (await page.evaluate(() => window.viewActions.length) !== before) throw new Error(`${id} contacted Host on cancel`)
    await page.waitForFunction(id => document.activeElement?.id === id, id)
  }
  await page.locator('#selectWorkMode').click()
  await page.getByRole('option', { name: 'Plan 先制定计划', exact: true }).click()
  await page.locator('#selectPermission').click()
  await page.getByRole('option', { name: '完全访问 跳过工具权限审批', exact: true }).click()
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click()
  if (await page.evaluate(() => window.demo.permission) !== 'default') throw new Error('Cancelled elevation changed permission')
  if (await page.evaluate(() => window.demo.workMode) !== 'plan') throw new Error('Offline mode was lost')
  await page.locator('#addAttachment').click()
  await page.getByRole('option', { name: '文件或图片 选择本地文件', exact: true }).click()
  if (await page.evaluate(() => window.demo.phase) !== 'disconnected') throw new Error('File picker connected Core')
  const actions = await page.evaluate(() => window.viewActions.filter(action => ['setWorkMode', 'pickAttachment'].includes(action.type)))
  if (JSON.stringify(actions) !== JSON.stringify([{ type: 'setWorkMode', workMode: 'plan' }, { type: 'pickAttachment', kind: 'file' }])) throw new Error('Incorrect menu actions')
  return 'LOCAL_COMPOSER_MENUS_OK'
}

async function catalogStyleChecks(page) {
  for (const [theme, width] of [['light', 900], ['dark', 380]]) {
    await page.setViewportSize({ width, height: 700 })
    await page.goto(`http://127.0.0.1:4318/?scenario=welcome&theme=${theme}`)
    for (const [title, query] of [['空间', '个人'], ['模型', 'Fast']]) {
      const trigger = page.getByRole('button', { name: `选择${title}`, exact: true })
      await trigger.click()
      const input = page.getByRole('combobox', { name: `搜索${title}`, exact: true })
      await input.waitFor()
      await page.waitForFunction(() => document.activeElement?.matches('[data-slot="command-input"]'))
      const checkStyle = async () => {
        const errors = await input.evaluate(el => {
          const row = el.parentElement, menu = el.closest('[data-slot="popover-content"]')
          const style = getComputedStyle(el), rowStyle = getComputedStyle(row), menuStyle = getComputedStyle(menu)
          const rect = el.getBoundingClientRect(), rowRect = row.getBoundingClientRect(), menuRect = menu.getBoundingClientRect()
          const probe = document.createElement('span')
          probe.style.color = 'var(--line)'
          menu.append(probe)
          const line = getComputedStyle(probe).color
          probe.style.color = 'var(--ink)'
          const ink = getComputedStyle(probe).color
          probe.style.color = 'var(--vscode-focusBorder, #0169cc)'
          const focus = getComputedStyle(probe).color
          probe.remove()
          return [
            ['native input border', ['Top', 'Right', 'Bottom', 'Left'].some(side => style[`border${side}Width`] !== '1px' || style[`border${side}Style`] !== 'solid')],
            ['missing separate rounded search field', style.borderRadius !== '8px' || rowStyle.borderBottomWidth !== '0px' || getComputedStyle(row.querySelector('svg')).display !== 'none'],
            ['input font or theme', style.fontFamily !== menuStyle.fontFamily || style.fontSize !== '13px' || style.color !== ink],
            ['input exceeds search row', rect.top < rowRect.top || rect.bottom > rowRect.bottom || rect.right > rowRect.right],
            ['menu border ignores theme', menuStyle.borderTopColor !== line],
            ['missing search focus indicator', style.borderColor !== focus],
            ['picker shell differs from original', menuStyle.borderRadius !== '14px' || menuStyle.padding !== '8px' || !menuStyle.backdropFilter.includes('blur(40px)')],
            ['opaque command covers translucent shell', getComputedStyle(el.closest('[cmdk-root]')).backgroundColor !== 'rgba(0, 0, 0, 0)'],
            ['menu exceeds viewport', menuRect.left < 0 || menuRect.right > innerWidth || menuRect.top < 0 || menuRect.bottom > innerHeight],
          ].filter(([, failed]) => failed).map(([label]) => label)
        })
        if (errors.length) throw new Error(`${theme} ${title}: ${errors.join(', ')}`)
      }
      await checkStyle()
      await page.locator('.composerCatalogMenu').getByRole('heading', { name: title, exact: true }).waitFor()
      await input.fill(query)
      await page.waitForFunction(() => document.querySelectorAll('.composerCatalogMenu [cmdk-item]').length === 1)
      await checkStyle()
      await input.fill('no-match-fixture')
      await page.getByText('没有匹配的选项', { exact: true }).waitFor()
      await input.fill('')
      await page.keyboard.press('Escape')
      await page.waitForFunction(title => document.activeElement?.getAttribute('aria-label') === `选择${title}`, title)
      await trigger.click()
      if (await input.inputValue() !== '') throw new Error('Reopened catalog retained old search')
      await page.getByRole('button', { name: '关闭菜单', exact: true }).click()
      await page.waitForFunction(title => document.activeElement?.getAttribute('aria-label') === `选择${title}`, title)
      await trigger.click()
      await input.fill(query)
      await page.waitForFunction(() => document.querySelectorAll('.composerCatalogMenu [cmdk-item]').length === 1)
      await input.press('Enter')
      await page.locator('.composerCatalogMenu').waitFor({ state: 'hidden' })
      await page.waitForFunction(title => window.viewActions.some(action => action.type === (title === '空间' ? 'chooseSpace' : 'chooseModel') && action.id === (title === '空间' ? 'personal' : 'model-two')), title)
      await trigger.click()
      await page.locator('.composerCatalogMenu [cmdk-item][data-current="true"][data-selected="true"]').waitFor()
      await page.keyboard.press('Escape')
    }
    await page.reload()
    await page.getByRole('button', { name: '选择空间', exact: true }).waitFor()
    if (await page.locator('.composerCatalogMenu').count()) throw new Error('Reload opened catalog unexpectedly')
    await page.locator('#prompt').fill('/')
    const commandSearch = page.getByRole('combobox', { name: '搜索会话命令', exact: true })
    await commandSearch.waitFor()
    if (!await commandSearch.evaluate(el => {
      const box = el.getBoundingClientRect(), row = el.parentElement.getBoundingClientRect()
      return getComputedStyle(el).borderTopWidth === '0px' && box.top >= row.top && box.bottom <= row.bottom
    })) throw new Error('Slash command search retained a separate broken input style')
    await commandSearch.press('Escape')
    if (await page.locator('#prompt').inputValue() !== '/') throw new Error('Slash search cancellation lost draft')
  }
}

async function fixedMenuStyleChecks(page) {
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 380, height: 700 })
    await page.goto(`http://127.0.0.1:4318/?scenario=welcome&theme=${theme}`)
    for (const [id, width] of [['selectWorkMode', 180], ['selectPermission', 280], ['selectEffort', 180], ['addAttachment', 280]]) {
      const before = await page.evaluate(() => window.viewActions.length)
      await page.locator(`#${id}`).click()
      const menu = page.locator('.composerPickerMenu')
      await menu.waitFor()
      const geometry = await menu.evaluate(el => {
        const style = getComputedStyle(el), item = getComputedStyle(el.querySelector('[data-slot="select-item"]'))
        return { width: parseFloat(style.width), radius: style.borderRadius, padding: style.padding, itemRadius: item.borderRadius }
      })
      if (geometry.width !== width || geometry.radius !== '14px' || geometry.padding !== '8px' || geometry.itemRadius !== '10px') throw new Error(`${id}: original picker dimensions lost ${JSON.stringify(geometry)}`)
      if (id === 'selectPermission' && await menu.locator('.composerMenuIcon').count() !== 3) throw new Error('Permission row icons missing')
      // Icon and label share one row: the icon sits left of the text and overlaps it vertically.
      const stacked = await menu.evaluate(el => [...el.querySelectorAll('[data-slot="select-item"]')].filter(item => {
        const icon = item.querySelector('.composerMenuIcon')?.getBoundingClientRect(), text = item.querySelector('.composerChoiceText')?.getBoundingClientRect()
        return icon && text && (icon.right > text.left || icon.bottom <= text.top || icon.top >= text.bottom)
      }).length)
      if (stacked) throw new Error(`${id}: ${stacked} row icons sit outside their text row`)
      await menu.getByRole('button', { name: '关闭菜单', exact: true }).click()
      await menu.waitFor({ state: 'hidden' })
      await page.waitForFunction(id => document.activeElement?.id === id, id)
      if (await page.evaluate(() => window.viewActions.length) !== before) throw new Error(`${id} sent Host action on close`)
    }
  }
}

/** codem.selectPermissionMode 只发 openPermissionMenu；界面在空闲时展开真实菜单，忙碌时作废这次请求。 */
async function permissionCommandChecks(page) {
  const request = () => page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'openPermissionMenu' } })))
  await page.goto('http://127.0.0.1:4318/?scenario=tools')
  await page.locator('#selectPermission').waitFor()
  await request()
  await page.waitForTimeout(200)
  if (await page.locator('.composerChoiceMenu').count()) throw new Error('Busy turn opened the permission menu')
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { ...window.demo, type: 'state', phase: 'ready' } })))
  await page.waitForFunction(() => !document.querySelector('#selectPermission')?.disabled)
  await page.waitForTimeout(200)
  if (await page.locator('.composerChoiceMenu').count()) throw new Error('A request made while busy opened the menu once the turn ended')
  await page.goto('http://127.0.0.1:4318/?scenario=disconnected')
  await page.locator('#selectPermission').waitFor()
  const before = await page.evaluate(() => window.viewActions.length)
  await request()
  const menu = page.locator('.composerChoiceMenu')
  await menu.waitFor()
  if (!(await menu.textContent())?.includes('权限模式')) throw new Error('Command opened the wrong menu')
  await page.waitForFunction(() => document.activeElement?.closest('.composerChoiceMenu'))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.id === 'selectPermission')
  if (await page.evaluate(() => window.viewActions.length) !== before) throw new Error('Opening the menu by command contacted Host')
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { ...window.demo, type: 'state' } })))
  await page.waitForTimeout(100)
  if (await menu.count()) throw new Error('A later snapshot replayed the menu request')
}
