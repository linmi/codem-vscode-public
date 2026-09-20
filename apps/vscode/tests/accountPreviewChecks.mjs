// Reuses the caller's page. Auth is simulated; this never opens a real login service.
export default async function accountPreviewChecks(page) {
  const viewport = page.viewportSize()
  try {
    for (const [width, height, theme] of [[1280, 720, 'light'], [380, 640, 'dark'], [320, 480, 'light']]) {
      await page.setViewportSize({width, height})
      await page.goto(`http://127.0.0.1:4318/?scenario=accountSignedOut&theme=${theme}`)
      const login = page.getByRole('button', {name:'登录 CodeM',exact:true})
      await login.waitFor()
      if (await page.locator('.app').isVisible()) throw Error('Signed-out screen exposed chat')
      await login.click()
      await page.getByText('请在浏览器中完成登录', {exact:true}).waitFor()
      await page.getByRole('button', {name:'取消登录',exact:true}).click()
      await page.getByText('已取消登录，可随时重试。', {exact:true}).waitFor()
      await login.click()
      const avatar = page.getByRole('button', {name:'个人账户：林晓',exact:true})
      await avatar.waitFor()
      await page.locator('#prompt').fill('保留草稿')
      await avatar.click()
      await page.getByRole('heading', {name:'个人账户',exact:true}).waitFor()
      const layout = await page.evaluate(() => ({
        header:document.querySelector('.accountHeader').getBoundingClientRect().height,
        bottom:document.querySelector('.accountPage').getBoundingClientRect().bottom,
        overflow:document.documentElement.scrollWidth>innerWidth,
      }))
      if (layout.header>48 || Math.abs(layout.bottom-height)>1 || layout.overflow) throw Error(JSON.stringify(layout))
      await page.getByRole('button', {name:'返回聊天',exact:true}).press('Escape')
      if (!await avatar.evaluate(node => node===document.activeElement)) throw Error('Missing avatar focus restoration')
      if (await page.locator('#prompt').inputValue() !== '保留草稿') throw Error('Account view lost draft')
      const chat = await page.locator('.app').boundingBox()
      if (!chat || chat.height<height-60 || Math.abs(chat.y+chat.height-height)>1) throw Error('Empty account root displaced chat')
      await avatar.click()
      await page.getByRole('button', {name:'刷新账户信息',exact:true}).click()
      await page.getByRole('button', {name:'返回聊天',exact:true}).click()
    }
    await page.goto('http://127.0.0.1:4318/?scenario=accountFailure&theme=dark')
    await page.getByRole('alert').waitFor()
    await page.getByRole('button', {name:'重新检查登录状态',exact:true}).click()
    await page.getByRole('alert').waitFor({state:'hidden'})
    return 'ACCOUNT_PREVIEW_OK'
  } finally { if (viewport) await page.setViewportSize(viewport) }
}
