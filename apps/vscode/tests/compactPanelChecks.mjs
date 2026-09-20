// Reuse the existing preview browser; this module does not launch a browser.
export default async function compactPanelChecks(page) {
  for (const [width, theme] of [[1440, 'dark'], [380, 'light']]) {
    await page.setViewportSize({width, height:700})
    await page.goto(`http://127.0.0.1:4318/?scenario=resourceFiles&theme=${theme}`)
    await page.getByRole('dialog', {name:'文件与工具',exact:true}).waitFor()
    const rows = await page.locator('.toolDiffRow').evaluateAll(nodes => nodes.map(node => ({
      overflow: node.scrollWidth > node.clientWidth,
      height: node.getBoundingClientRect().height,
      actionsVisible: [...node.querySelectorAll('button')].every(button => button.getBoundingClientRect().right <= node.getBoundingClientRect().right + 1),
    })))
    if (rows.length !== 4 || rows.some(row => row.overflow || !row.actionsVisible)) throw Error('File row overflows or loses actions')
    if (width > 520 && rows[0].height > 60) throw Error('Short file row became a tall card')
    await page.getByRole('button', {name:'关闭文件与工具'}).click()
    await page.getByRole('button', {name:'会话命令',exact:true}).click()
    await page.getByRole('combobox', {name:'搜索会话命令'}).fill('delete')
    await page.getByRole('combobox', {name:'搜索会话命令'}).press('Enter')
    const dialog = page.getByRole('dialog', {name:'删除会话记录'})
    await dialog.waitFor()
    const layout = await dialog.evaluate(node => ({width:node.clientWidth,height:node.clientHeight,overflow:node.scrollWidth>node.clientWidth}))
    if (layout.width > 420 || layout.height > 320 || layout.overflow) throw Error('Confirmation is oversized or clipped')
    const [cancel, confirm] = await Promise.all(['取消','确认删除'].map(name => dialog.getByRole('button',{name,exact:true}).boundingBox()))
    if (!cancel || !confirm || Math.abs(cancel.y-confirm.y)>1 || cancel.x>=confirm.x) throw Error('Confirmation actions are not aligned')
    await page.getByRole('combobox',{name:'操作目标会话'}).click()
    await page.getByRole('listbox').waitFor()
    await page.keyboard.press('Escape')
    await dialog.getByRole('button',{name:'取消',exact:true}).click()
    if (await page.evaluate(() => window.viewActions.some(action => action.type === 'manageThread'))) throw Error('Cancel changed a thread')
  }
  return 'COMPACT_PANELS_OK'
}
