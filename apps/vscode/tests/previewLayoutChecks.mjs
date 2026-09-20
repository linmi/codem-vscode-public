export default async function previewLayoutChecks(page) {
  const originalViewport = await page.evaluate(() => ({width: innerWidth, height: innerHeight}))
  try {
    for (const viewport of [{width:1440,height:900}, {width:380,height:800}, {width:760,height:500}]) {
      await page.setViewportSize(viewport)
      await page.goto('http://127.0.0.1:4318/?scenario=thinking&theme=light')
      await page.getByRole('combobox',{name:'预览场景'}).waitFor()
      const layout = await page.evaluate(() => {
        const app = document.querySelector('.app').getBoundingClientRect()
        const toolbar = document.querySelector('.previewToolbar').getBoundingClientRect()
        const footer = document.querySelector('footer').getBoundingClientRect()
        return {left:app.left,right:innerWidth-app.right,bottom:app.bottom,height:innerHeight,top:app.top,toolbarBottom:toolbar.bottom,footerBottom:footer.bottom,overflow:document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight}
      })
      if (Math.abs(layout.left-layout.right)>1 || Math.abs(layout.bottom-layout.height)>1 || Math.abs(layout.top-layout.toolbarBottom)>1 || Math.abs(layout.footerBottom-layout.height)>1 || layout.overflow) throw Error(JSON.stringify({viewport,layout}))
      if (viewport.width===1440) await page.screenshot({path:'output/playwright/previewCentered.png'})
    }
    return 'PREVIEW_LAYOUT_OK: centered, full height, visible footer, no outer overflow'
  } finally {
    await page.setViewportSize(originalViewport)
  }
}
