export default async function previewRouterChecks(page) {
  const originalViewport = await page.evaluate(() => ({width:innerWidth,height:innerHeight}))
  let documentRequests = 0
  const onRequest = request => { if (request.resourceType()==='document') documentRequests++ }
  const errors = []
  const onError = error => errors.push(String(error))
  try {
    await page.setViewportSize({width:1440,height:1000})
    await page.goto('http://127.0.0.1:4318/?scenario=conversation&theme=light')
    await page.getByRole('navigation',{name:'场景目录'}).waitFor()
    page.on('request', onRequest)
    page.on('pageerror', onError)
    await page.evaluate(() => { window.previewShell = document.querySelector('.app'); window.previewToc = document.querySelector('.previewToc'); window.previewLoadTime = performance.timeOrigin })
    const toc = page.getByRole('navigation',{name:'场景目录'})
    await toc.getByRole('link',{name:'空间选择',exact:true}).click()
    await page.getByRole('dialog').getByText('刷新空间列表',{exact:true}).click()
    await page.getByText('正在刷新空间列表…',{exact:true}).waitFor()
    await toc.getByRole('link',{name:'思考中',exact:true}).click()
    await page.waitForFunction(() => demo.phase==='running' && document.querySelector('.decisionPanel').hidden)
    // Verify the old async callback has no authority after its original 500ms deadline.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve,600)))
    if (await page.getByRole('dialog').isVisible()) throw Error('Previous scene reopened a panel')
    await page.goBack()
    await page.getByRole('dialog').getByText('空间',{exact:true}).waitFor()
    await page.goForward()
    await page.waitForFunction(() => demo.phase==='running' && document.querySelector('.decisionPanel').hidden)
    await page.getByRole('combobox',{name:'预览主题'}).click()
    await page.getByRole('option',{name:'深色',exact:true}).click()
    await page.waitForFunction(() => document.body.classList.contains('vscode-dark'))
    await page.getByRole('button',{name:'重置',exact:true}).click()
    await page.waitForFunction(() => document.querySelector('.app').dataset.phase==='running')
    const timings = await page.evaluate(async () => {
      const times = []
      const toc = document.querySelector('.previewToc')
      toc.scrollTop = 200
      const scrollTop = toc.scrollTop
      for (const scenario of ['approval','question','tools','welcome','thinking','conversation']) {
        const link = [...toc.querySelectorAll('a')].find(link=>new URL(link.href).searchParams.get('scenario')===scenario)
        const before = demo
        const start = performance.now()
        link.click()
        await new Promise((resolve,reject) => {
          function frame() {
            if (performance.now()-start>1000) { reject(Error('Scene update exceeded 1s')); return }
            if (demo!==before) requestAnimationFrame(resolve)
            else requestAnimationFrame(frame)
          }
          requestAnimationFrame(frame)
        })
        times.push(Math.round(performance.now()-start))
      }
      if (toc.scrollTop!==scrollTop) throw Error('TOC scrolled during scene switches')
      return times
    })
    if (!await page.evaluate(() => window.previewShell===document.querySelector('.app') && window.previewToc===document.querySelector('.previewToc') && window.previewLoadTime===performance.timeOrigin)) throw Error('Preview shell remounted')
    if (documentRequests) throw Error('Scenario navigation requested a new document')
    if(errors.length) throw Error(errors.join('\n'))
    return {result:'PREVIEW_ROUTER_OK',documentRequests,scenePaintMs:timings}
  } finally {
    page.off('request',onRequest); page.off('pageerror',onError)
    await page.setViewportSize(originalViewport)
  }
}
