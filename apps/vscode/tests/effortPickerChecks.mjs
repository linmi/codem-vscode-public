export default async function effortPickerChecks(page) {
  for (const width of [320, 430, 1000]) {
    await page.setViewportSize({width, height:800});
    await page.goto('http://127.0.0.1:4318/?empty=1');
    const trigger = page.getByRole('button', {name:'思考强度：medium', exact:true});
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    if (await dialog.getByRole('slider').count()) throw new Error('Obsolete slider');
    if (await dialog.locator('.decisionChoice').count() !== 4) throw new Error('Missing effort choices');
    if (await dialog.getByRole('button', {name:/medium 默认/}).getAttribute('aria-pressed') !== 'true') throw new Error('Default selection missing');
    const geometry = await page.evaluate(() => {
      const menu = document.querySelector('.pickerPanel').getBoundingClientRect();
      const button = document.querySelector('#selectEffort').getBoundingClientRect();
      const model = document.querySelector('#selectModel').getBoundingClientRect();
      return {gap:button.top-menu.bottom,left:menu.left,right:menu.right,separate:button.right<=model.left,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    if(Math.abs(geometry.gap-8)>1 || geometry.left<11 || geometry.right>width-11 || !geometry.separate || geometry.overflow) throw new Error(JSON.stringify(geometry));
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    if (!await trigger.evaluate(el => el===document.activeElement)) throw new Error('Focus not restored');
    await trigger.click();
    await dialog.getByRole('button',{name:/xhigh/}).click();
    const reply = await page.evaluate(() => window.panelReplies.at(-1));
    if (!JSON.stringify(reply).includes('xhigh')) throw new Error('Wrong effort reply');
    await page.getByRole('button',{name:'选择模型',exact:true}).click();
    if(await dialog.getByText('思考强度',{exact:true}).count()) throw new Error('Effort still inside model picker');
  }
  await page.goto('http://127.0.0.1:4318/?empty=1');
  await page.getByRole('button',{name:'思考强度：medium',exact:true}).click();
  await page.screenshot({path:'output/playwright/effortPicker.png'});
  return 'SPLIT_EFFORT_PICKER_OK';
}
