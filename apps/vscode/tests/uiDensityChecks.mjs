// Called by the existing browser harness; never launches a browser.
export default async function uiDensityChecks(page) {
  const openCommand = async name => {
    await page.getByRole('button',{name:'会话命令',exact:true}).click()
    await page.getByRole('combobox',{name:'搜索会话命令'}).fill(name)
    await page.getByRole('combobox',{name:'搜索会话命令'}).press('Enter')
  }
  await page.goto('http://127.0.0.1:4318/?scenario=conversation&theme=dark')
  for (const operation of ['rename','fork','archive']) {
    await openCommand(operation)
    const dialog = page.getByRole('dialog')
    if (await dialog.getByRole('combobox').count() || await dialog.getByRole('button',{name:'加载会话列表'}).count()) throw Error('Current conversation operation gained a target picker')
    if (operation === 'rename') {
      await dialog.getByRole('textbox',{name:'新的会话名称'}).fill('')
      if (await dialog.getByRole('button',{name:'确认重命名'}).isEnabled()) throw Error('Empty rename accepted')
      await dialog.getByRole('textbox',{name:'新的会话名称'}).fill('测试会话名')
    }
    await dialog.getByRole('button',{name:/^确认/}).click()
    const action = await page.evaluate(() => window.viewActions.findLast(action => action.type === 'manageThread'))
    if (action?.operation !== operation || action.threadId !== await page.evaluate(() => window.demo.threadId)) throw Error('Operation did not target current thread')
  }
  await openCommand('unarchive')
  if (await page.getByRole('button',{name:'确认解除归档'}).isEnabled()) throw Error('Unarchive accepted missing target')
  await page.getByRole('button',{name:'取消',exact:true}).click()
  for (const theme of ['light','dark']) {
    await page.setViewportSize({width:380,height:500})
    for (const scenario of ['attachmentsMany','questionLong','planLong']) {
      await page.goto(`http://127.0.0.1:4318/?scenario=${scenario}&theme=${theme}`)
      await page.locator('#openCommands').waitFor()
      const bounds = await page.locator('.composerToolbar').boundingBox()
      if (!bounds || bounds.y < 0 || bounds.y + bounds.height > 500) throw Error(`${scenario}: composer toolbar clipped`)
    }
    await page.goto(`http://127.0.0.1:4318/?scenario=historyPaging&theme=${theme}`)
    const history = page.getByRole('region',{name:'历史会话'})
    await history.waitFor()
    if (!await history.getByRole('button',{name:'加载更多会话'}).isVisible()) throw Error('History paging hidden')
    await page.goto(`http://127.0.0.1:4318/?scenario=catalogEmpty&theme=${theme}`)
    await page.getByRole('dialog').waitFor()
    const bounds = await page.getByRole('dialog').boundingBox()
    if (!bounds || bounds.height > 380) throw Error('Empty catalog still fills the window')
  }
  const surfaces = [
    ['sessionManage','.sessionCommandDialog'], ['sessionDirectories','.sessionCommandDialog'],
    ['catalogEmpty','.sessionCommandDialog'], ['catalogEnvironment','.sessionCommandDialog'],
    ['catalogSkills','.sessionCommandDialog'], ['catalogStale','.sessionCommandDialog'],
    ['resourceFiles','#activityPanel'], ['resourceBackground','#activityPanel'], ['resourceTools','#activityPanel'],
    ['historyPaging','#historyPanel'], ['historyEmpty','#historyPanel'], ['historyFailure','#historyPanel'],
    ['questionLong','.decisionPanel:not([hidden])'], ['planLong','.decisionPanel:not([hidden])'],
    ['attachmentsMany','#attachments'], ['rewind','.rewindDialog'], ['sideQuestionFailed','.composerSideAnswer'], ['turnChanges','.turnChanges'],
  ]
  for (const [width,height] of [[380,500],[1024,768]]) for (const theme of ['light','dark']) {
    await page.setViewportSize({width,height})
    for (const [scenario,selector] of surfaces) {
      await page.goto(`http://127.0.0.1:4318/?scenario=${scenario}&theme=${theme}`)
      await page.locator(selector).first().waitFor()
      const clipped = await page.locator('footer, .toolDialog, .rewindDialog, .historyPanel:not([hidden]), .toolDiffRow, .toolResourceCard').evaluateAll(nodes => nodes.some(node => {
        const bounds = node.getBoundingClientRect()
        const surface = node.tagName === 'FOOTER' || node.matches('.toolDialog,.rewindDialog,.historyPanel')
        return node.scrollWidth > node.clientWidth + 1 || (surface && (bounds.y < 0 || bounds.bottom > window.innerHeight + 1))
      }))
      if (clipped) throw Error(`${scenario} ${theme} ${width}: surface clipped`)
    }
  }
  return 'UI_DENSITY_OK'
}
