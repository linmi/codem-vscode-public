export default async function composerMenuChecks(page) {
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
