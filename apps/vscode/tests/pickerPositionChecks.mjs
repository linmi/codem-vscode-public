export default async function pickerPositionChecks(page) {
  const results = [];
  for (const width of [320, 430, 1000]) {
    await page.setViewportSize({width,height:800});
    await page.goto('http://127.0.0.1:4318/?empty=1');
    await page.getByRole('button',{name:'选择模型',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    for (const height of [800, 480]) {
      await page.setViewportSize({width,height});
      for (const text of ['', 'Draft line\n'.repeat(15)]) {
        await page.keyboard.press('Escape');
        await page.locator('#prompt').fill(text);
        await page.getByRole('button',{name:'选择模型',exact:true}).click();
        await page.getByRole('dialog',{name:'模型',exact:true}).waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const geometry = await page.evaluate(() => {
          const panel = document.querySelector('.composerCatalogMenu').getBoundingClientRect();
          const button = document.querySelector('#selectModel').getBoundingClientRect();
          return {gap:button.top-panel.bottom,top:panel.top,left:panel.left,right:panel.right,buttonRight:button.right,overflow:document.documentElement.scrollWidth>innerWidth};
        });
        if (Math.abs(geometry.gap-8)>1 || geometry.top<7 || geometry.left<11 || geometry.right>width-11 || geometry.overflow) throw new Error(JSON.stringify({width,height,geometry}));
        if(width>=430 && Math.abs(geometry.right-geometry.buttonRight)>1) throw new Error('Menu does not align with trigger');
        results.push({width,height,multiline:!!text,...geometry});
      }
    }
    await page.getByRole('combobox',{name:'搜索模型'}).fill('No matching model');
    await page.getByText('没有匹配的选项').waitFor();
    const gap = await page.evaluate(() => document.querySelector('#selectModel').getBoundingClientRect().top-document.querySelector('.composerCatalogMenu').getBoundingClientRect().bottom);
    if(Math.abs(gap-8)>1) throw new Error('Filtering moved menu away from anchor');
  }
  return {status:'PICKER_ANCHORED_OK',results};
}
