export default async function footerLayoutChecks(page) {
  const results = [];
  for (const width of [320, 430, 1000]) {
    await page.setViewportSize({width, height: 800});
    await page.goto('http://127.0.0.1:4318/?empty=1');
    const trigger = page.getByRole('button', {name: '模型与思考强度', exact: true});
    await trigger.waitFor();
    const measure = () => page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {top:r.top,height:r.height,right:r.right}; };
      return {composer:box('.composer'), footer:box('.footerMeta'), hint:box('#status'), overflow:document.documentElement.scrollWidth>innerWidth};
    });
    const before = await measure();
    if (before.overflow || before.footer.height !== 24 || before.hint.height !== 24 || Math.abs(before.hint.right-before.footer.right)>1) throw new Error(`Invalid footer layout at ${width}`);
    for (let i=0;i<3;i++) {
      await trigger.click();
      await page.getByRole('dialog').waitFor();
      const open = await measure();
      if (JSON.stringify(open)!==JSON.stringify(before)) throw new Error(`Menu opening shifted composer at ${width}`);
      await page.getByRole('button',{name:'关闭菜单'}).click();
      await page.getByRole('dialog').waitFor({state:'hidden'});
      const closed = await measure();
      if (JSON.stringify(closed)!==JSON.stringify(before)) throw new Error(`Menu closing shifted composer at ${width}`);
    }
    results.push({width,...before});
  }
  return {status:'FOOTER_STABLE_OK',results};
}
