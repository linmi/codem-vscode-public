export default async function turnChangesChecks(page) {
  await page.goto('http://127.0.0.1:4318/?scenario=turnChanges&theme=dark')
  await page.locator('.turnChanges[data-turn-id="second"]').waitFor()
  if (await page.locator('.workGroup .turnChanges').count()) throw Error('File changes folded into tool records')
  if (await page.locator('.turnChanges').count() !== 2) throw Error('Missing turn or empty turn generated changes')
  const order = await page.locator('#messages').evaluate(root => [...root.children].map(node => node.textContent))
  const first = order.findIndex(text => text.includes('本轮文件变更1 处'))
  const secondUser = order.findIndex(text => text.includes('继续补充登录校验。'))
  const second = order.findIndex(text => text.includes('本轮文件变更2 处'))
  const thirdUser = order.findIndex(text => text.includes('还有哪些需要测试？'))
  if (!(first < secondUser && secondUser < second && second < thirdUser)) throw Error('Diff summary crossed turn boundary')
  const summary = page.locator('.turnChanges[data-turn-id="second"]')
  if (await summary.getByRole('button').count() !== 2 || await summary.getByRole('button').last().isEnabled()) throw Error('Repeated or unavailable diff missing')
  await summary.getByRole('button').first().click()
  await page.getByText('模拟预览已收到打开请求；不会访问真实文件或外部链接。', {exact:true}).waitFor()
  await page.getByRole('link', {name:'新会话',exact:true}).click()
  await page.locator('.turnChanges').waitFor({state:'hidden'})
  return 'TURN_CHANGES_OK'
}
