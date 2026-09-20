export default async function activityPresentationChecks(page) {
  const viewport = await page.evaluate(() => ({width:innerWidth,height:innerHeight}));
  try {
    await page.goto('http://127.0.0.1:4318/?scenario=thinking');
    const reasoning = page.locator('.activityMessage[data-role="reasoning"]');
    await reasoning.locator('summary').click();
    if (await reasoning.locator('.activityNote').isVisible()) throw new Error('Expanded activity repeats its title');
    const bodyStyle = await reasoning.locator('.messageBody').evaluate(el => {
      const css = getComputedStyle(el);
      return {border:css.borderLeftWidth,padding:css.paddingLeft,color:css.color,font:css.fontSize};
    });
    if (bodyStyle.border !== '0px' || bodyStyle.padding !== '0px') throw new Error('Reasoning retains nested quote styling');
    await page.screenshot({animations:'disabled',path:'output/playwright/activityReasoning.png'});
    await page.evaluate(() => { demo.messages[1].text += '\n\n第二段进度'; window.postMessage(demo,'*'); });
    await reasoning.getByText('第二段进度',{exact:true}).waitFor();
    if (!await reasoning.locator('details').evaluate(el => el.open)) throw new Error('Streaming reset disclosure');

    await page.goto('http://127.0.0.1:4318/?scenario=tools');
    const tool = page.locator('.activityMessage[data-role="tool"]');
    if (await tool.locator('.activityStatus').isVisible()) throw new Error('Running tool repeats an in-progress badge');
    await page.locator('.workGroup > summary').click();
    await page.locator('.workGroup > summary').click();
    await tool.locator('summary').press('Enter');
    await tool.locator('.toolOutput').waitFor();
    await tool.getByText('Shell',{exact:true}).waitFor();
    if (await tool.locator('.toolOutput').count() !== 1) throw new Error('Split tool output cards');
    if (!await tool.locator('.toolOutput .toolCommand').isVisible() || !await tool.locator('.toolOutput .messageBody').isVisible()) throw new Error('Missing command or output');
    await page.screenshot({animations:'disabled',path:'output/playwright/activityTool.png'});
    await page.evaluate(() => {
      demo.messages[2].text = '<script>window.injected=true</script>\n' + 'output '.repeat(2000);
      demo.messages[2].details.code = 'echo ' + 'longCommand'.repeat(100);
      window.postMessage(demo,'*');
    });
    await tool.locator('.messageBody').getByText('<script>window.injected=true</script>',{exact:false}).waitFor();
    if (await page.evaluate(() => window.injected === true)) throw new Error('Tool output executed');
    await page.setViewportSize({width:420,height:800});
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Tool card overflows narrow view');
    await page.evaluate(() => { demo.messages[2].status='completed'; demo.phase='ready'; window.postMessage(demo,'*'); });
    await tool.locator('.activityTitle').getByText('已运行',{exact:false}).waitFor();
    if (!await tool.locator('details').evaluate(el => el.open)) throw new Error('Completion reset disclosure');
    await tool.locator('summary').press('Enter');
    await tool.locator('.toolOutput').waitFor({state:'hidden'});
    await page.goto('http://127.0.0.1:4318/?scenario=failed&theme=dark');
    await page.locator('.toolOutput').waitFor();
    await page.locator('.activityStatus').getByText('失败',{exact:true}).waitFor();
    await page.screenshot({animations:'disabled',path:'output/playwright/activityFailureDark.png'});
    return 'ACTIVITY_PRESENTATION_OK';
  } finally {
    await page.setViewportSize(viewport);
    await page.goto('http://127.0.0.1:4318/?scenario=thinking');
    await page.locator('.activityMessage[data-role="reasoning"] summary').click();
  }
}
