async function checkActivityAlignment(page) {
  const offsets = await page.locator('.activityMessage summary').evaluateAll(rows => rows.flatMap(row => {
    if (!row.getBoundingClientRect().height) return [];
    const parts = [...row.querySelectorAll('.activityIcon svg, .activityTitle, .beautifulLoadingGrid, .beautifulLoadingLabel, .activityChevron svg')]
      .map(node => node.getBoundingClientRect()).filter(rect => rect.height > 0);
    const centers = parts.map(rect => rect.top + rect.height / 2);
    return centers.length ? [Math.max(...centers) - Math.min(...centers)] : [];
  }));
  if (!offsets.length || offsets.some(offset => offset > 1)) throw new Error(`Activity icons, text and arrows are misaligned: ${offsets}`);
}

export default async function loadingStateChecks(page) {
  const errors = [];
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  const viewport = await page.evaluate(() => ({width: innerWidth, height: innerHeight}));
  try {
    await page.goto('http://127.0.0.1:4318/?scenario=thinking');
    await page.locator('.activityLoading .beautifulLoading').waitFor();
    await page.locator('.activityLoading').getByText('正在分析实现方案', {exact:true}).waitFor();
    if (await page.locator('.workGroup > summary .beautifulLoading').count()) throw new Error('Header still has loading animation');
    await page.locator('.workGroup > summary').getByText(/已处理 \d+秒/).waitFor();
    if (await page.locator('.activityStatus:visible').count()) throw new Error('Duplicate thinking badge');
    if (await page.locator('#workingRow').isVisible()) throw new Error('Duplicate thinking footer');
    if (await page.locator('.activityLoading .beautifulLoadingGrid > span').count() !== 9) throw new Error('Missing pixel grid');
    await checkActivityAlignment(page);
    await page.evaluate(() => { window.savedGrid = document.querySelector('.workGroup .beautifulLoadingGrid'); demo.messages[1].text += ' delta'; window.postMessage(demo,'*'); });
    await page.waitForFunction(() => document.querySelector('[data-role=reasoning] .messageBody').textContent.includes(' delta'));
    if (!await page.evaluate(() => savedGrid === document.querySelector('.workGroup .beautifulLoadingGrid'))) throw new Error('Streaming remounts the loading animation');
    const layout = await page.locator('.workGroup > summary').evaluate(el => {
      const text = el.firstElementChild.getBoundingClientRect();
      const icon = el.querySelector('.workGroupChevron').getBoundingClientRect();
      return {textRight:text.right, iconLeft:icon.left, iconRight:icon.right, right:el.getBoundingClientRect().right};
    });
    if (layout.iconLeft < layout.textRight || Math.abs(layout.right-layout.iconRight) > 1) throw new Error('Collapse arrow is not aligned right');
    await page.locator('.workGroup > summary').click();
    if (await page.locator('.workGroup').getAttribute('open') !== null) throw new Error('Cannot collapse work group');
    await page.locator('.workGroup > summary').press('Enter');
    if (await page.locator('.workGroup').getAttribute('open') === null) throw new Error('Cannot expand work group with keyboard');
    await page.screenshot({path:'output/playwright/beautifulLoadingLight.png'});

    await page.evaluate(() => { demo.messages.push({id:'next',role:'user',label:'你',text:'下一轮'}); window.postMessage(demo,'*'); });
    await page.locator('#workingRow .beautifulLoading').waitFor();
    if (await page.locator('#workingLabel').innerText() !== '正在思考与处理…') throw new Error('History suppressed new-turn placeholder');
    await page.emulateMedia({reducedMotion:'reduce'});
    const motion = await page.locator('#workingRow .beautifulLoadingGrid > span').first().evaluate(el => getComputedStyle(el).animationName);
    if (motion !== 'none') throw new Error('Reduced motion ignored');
    await page.emulateMedia({forcedColors:'active'});
    const color = await page.locator('#workingRow .beautifulLoadingLabel').evaluate(el => getComputedStyle(el).color);
    if (color === 'rgba(0, 0, 0, 0)') throw new Error('High contrast text invisible');
    await page.emulateMedia({reducedMotion:'no-preference', forcedColors:'none'});
    await page.evaluate(() => { demo.messages.push({id:'progress',role:'assistant',label:'CodeM',text:'开始处理新请求'}); window.postMessage(demo,'*'); });
    await page.locator('#workingRow').waitFor({state:'hidden'});
    await page.evaluate(() => { demo.phase='stopping'; window.postMessage(demo,'*'); });
    await page.locator('#workingLabel').getByText('正在停止…',{exact:true}).waitFor();
    await page.evaluate(() => { demo.phase='ready'; demo.messages.forEach(m => {if('status' in m) m.status='completed'}); window.postMessage(demo,'*'); });
    await page.locator('.beautifulLoading').waitFor({state:'detached'});

    for (const [scenario,label] of [['approval','等待你的批准…'],['question','等待你的回复…'],['plan','等待你确认计划…']]) {
      await page.goto(`http://127.0.0.1:4318/?scenario=${scenario}`);
      await page.locator('#workingLabel').getByText(label,{exact:true}).waitFor();
      if (await page.locator('#workingRow .beautifulLoading').getAttribute('data-animated') !== 'false') throw new Error('Waiting state animates indefinitely');
    }
    await page.setViewportSize({width:420,height:800});
    await page.goto('http://127.0.0.1:4318/?scenario=thinking&theme=dark');
    await page.locator('.workGroup .beautifulLoading').waitFor();
    await checkActivityAlignment(page);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Narrow loading layout overflows');
    await page.screenshot({path:'output/playwright/beautifulLoadingDark.png'});
    await page.goto('http://127.0.0.1:4318/?scenario=failed');
    await page.locator('.activityStatus:visible').getByText('失败',{exact:true}).waitFor();
    await checkActivityAlignment(page);
    if (errors.length) throw new Error(errors.join('\n'));
    return 'LOADING_STATE_OK';
  } finally {
    page.off('pageerror',onError);
    await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
    await page.setViewportSize(viewport);
    await page.goto('http://127.0.0.1:4318/?scenario=thinking');
  }
}
