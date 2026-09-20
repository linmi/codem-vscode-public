import accountPreviewChecks from "./accountPreviewChecks.mjs"
import runtimePopoverChecks from "./runtimePopoverChecks.mjs"

// Browser fixtures only. All state transitions stay local and never contact Core.
export default async function richPreviewChecks(page) {
  const errors = []
  const capture = error => errors.push(String(error))
  page.on('pageerror', capture)
  const checks = []
  try {
    for (const [theme, width] of [['light', 1440], ['dark', 380]]) {
      await page.setViewportSize({width, height:900})
      await page.goto(`http://127.0.0.1:4318/?scenario=toolDetails&theme=${theme}`)
      await page.locator('.toolOutput').first().waitFor()
      if (await page.locator('.toolOutput:visible').count() !== 6) throw Error('Not all tool details are inspectable')
      if (await page.locator('.workGroup [data-role=assistant]').count()) throw Error('Assistant text folded into tools')
      await page.screenshot({animations:'disabled',path:`output/playwright/richTools-${theme}.png`})
      await page.goto(`http://127.0.0.1:4318/?scenario=artifactGallery&theme=${theme}`)
      if (await page.locator('.artifactCard').count() !== 5) throw Error('Missing artifact kind')
      await page.screenshot({animations:'disabled',path:`output/playwright/richArtifacts-${theme}.png`})
      for (const [scenario, selector] of [['resourceFiles','[data-resource-section="files"]'],['resourceTools','[data-resource-section="tools"]'],['resourceBackground','[data-resource-section="background"]']]) {
        await page.goto(`http://127.0.0.1:4318/?scenario=${scenario}&theme=${theme}`)
        await page.locator(selector).waitFor()
        if (!(await page.locator(selector).innerText()).trim()) throw Error('Empty resource fixture')
      }
      for (const [scenario, label] of [['catalogEnvironment','Node.js'],['catalogPlugins','design-preview'],['catalogProvider','CodeM Reasoning'],['catalogStale','review-ui']]) {
        await page.goto(`http://127.0.0.1:4318/?scenario=${scenario}&theme=${theme}`)
        await page.locator('.catalogRows dt').getByText(label,{exact:true}).waitFor()
        await page.getByRole('listbox').waitFor({state:'hidden'})
        await page.screenshot({animations:'disabled',path:`output/playwright/rich-${scenario}-${theme}.png`})
      }
      checks.push(`${theme}: tools, artifacts, runtime, resource panels and catalogs`)
    }
    await accountPreviewChecks(page)
    await runtimePopoverChecks(page)
    await page.goto('http://127.0.0.1:4318/?scenario=imageGallery')
    await page.getByRole('button',{name:'预览 工作区概览.png'}).click()
    await page.locator('dialog.imagePreview').waitFor()
    const size = await page.locator('.previewImage').evaluate(image => ({width:image.naturalWidth,height:image.naturalHeight}))
    if (size.width!==960 || size.height!==540) throw Error('Fixture image did not decode')
    await page.getByRole('button',{name:'原始尺寸'}).click()
    await page.getByRole('button',{name:'适应窗口'}).waitFor()
    await page.screenshot({animations:'disabled',path:'output/playwright/richImage.png'})
    await page.keyboard.press('Escape')
    await page.goto('http://127.0.0.1:4318/?scenario=imageUnavailable')
    await page.getByRole('button',{name:'加载图片 稍后重试.png'}).getByText('重试图片',{exact:true}).waitFor()
    await page.getByRole('button',{name:'加载图片 稍后重试.png'}).click()
    await page.getByRole('button',{name:'预览 稍后重试.png'}).waitFor()
    await page.goto('http://127.0.0.1:4318/?scenario=attachments')
    await page.getByRole('button',{name:'移除附件 src/main.ts',exact:true}).click()
    if (await page.locator('.attachmentCard').count() !== 1) throw Error('Attachment removal not reflected')
    await page.goto('http://127.0.0.1:4318/?scenario=tools')
    await page.getByRole('button',{name:'停止生成',exact:true}).click()
    if (!await page.evaluate(()=>demo.phase==='ready' && demo.messages.filter(m=>'status' in m).every(m=>m.status!=='running'))) throw Error('Stopping leaves running records')
    await page.getByRole('button',{name:'新建会话',exact:true}).click()
    await page.locator('#welcome').waitFor()
    if (await page.locator('#messages > *').count()) throw Error('New chat kept old records')
    await page.goto('http://127.0.0.1:4318/?scenario=questionBack')
    await page.getByRole('button',{name:'上一题',exact:true}).click()
    await page.getByText('实现方向 · 1/2',{exact:true}).waitFor()
    await page.getByRole('button',{name:/聊天界面/}).click()
    await page.getByRole('button',{name:'下一题',exact:true}).click()
    await page.getByText('验证范围 · 2/2',{exact:true}).waitFor()
    await page.getByRole('button',{name:'提交回答',exact:true}).click()
    await page.locator('.decisionPanel').waitFor({state:'hidden'})
    // Reuse the same document: surface selection, theme preservation and reset ownership.
    await page.setViewportSize({width:1440,height:900})
    await page.goto('http://127.0.0.1:4318/?scenario=resourceTools')
    await page.locator('[data-resource-section="tools"]').waitFor()
    const toc=page.getByRole('navigation',{name:'场景目录'})
    await page.getByRole('button',{name:'关闭文件与工具',exact:true}).click()
    await toc.getByRole('link',{name:'新会话',exact:true}).click()
    await page.locator('#activityPanel').waitFor({state:'hidden'})
    await toc.getByRole('link',{name:'六类工具 · 参数与输出',exact:true}).click()
    await page.locator('.toolOutput').first().waitFor()
    await page.getByRole('combobox',{name:'预览主题'}).click()
    await page.getByRole('option',{name:'深色',exact:true}).click()
    if (await page.locator('.toolOutput:visible').count() !== 6) throw Error('Theme reset open tool content')
    await page.getByRole('button',{name:'重置',exact:true}).click()
    await page.locator('.toolOutput').first().waitFor()
    if (await page.locator('.toolOutput:visible').count() !== 6) throw Error('Reset did not restore inspection state')
    await page.reload()
    await page.locator('.toolOutput').first().waitFor()
    if (errors.length) throw Error(errors.join('\n'))
    return {status:'RICH_PREVIEW_OK',checks,image:size}
  } finally { page.off('pageerror',capture) }
}
