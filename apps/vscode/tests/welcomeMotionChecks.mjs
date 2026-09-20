export default async function welcomeMotionChecks(page) {
  const originalUrl = page.url();
  const errors = [];
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  const send = phase => page.evaluate(phase => window.postMessage({...demo, phase, messages: [], notice: null}, '*'), phase);
  const motion = async expected => {
    await page.locator(`#welcome[data-motion="${expected}"]`).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.welcomePixel').length === 7);
  };
  try {
    for (const theme of ['light', 'dark']) {
      await page.goto(`http://127.0.0.1:4318/?scenario=disconnected&theme=${theme}`);
      await motion('idle');
      const before = await page.locator('#welcome').boundingBox();
      await page.locator('#prompt').fill('保留输入中的草稿');
      await send('connecting');
      await motion('initializing');
      if (await page.locator('#workingRow').isVisible()) throw new Error('Duplicate initialization indicator');
      const after = await page.locator('#welcome').boundingBox();
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Welcome moved during initialization');
      const animations = await page.locator('.welcomePixel').evaluateAll(nodes => nodes.map(node => ({ name: getComputedStyle(node).animationName, delay: getComputedStyle(node).animationDelay })));
      if (animations.some(a => a.name !== 'welcomePixelPulse') || new Set(animations.map(a => a.delay)).size !== 7) throw new Error('Logo blocks do not animate in sequence');
      if (await page.locator('#welcomeTitle').evaluate(node => getComputedStyle(node).animationName) !== 'welcomeTitleBreathe') throw new Error('Welcome title does not breathe');
      await page.evaluate(() => { window.welcomeAnimation = document.querySelector('.welcomePixel').getAnimations()[0] });
      await send('connecting');
      await page.waitForFunction(() => document.querySelector('.welcomePixel').getAnimations()[0] === window.welcomeAnimation);
      await page.emulateMedia({reducedMotion:'reduce'});
      if (await page.locator('.welcomePixel').first().evaluate(node => getComputedStyle(node).animationName) !== 'none') throw new Error('Reduced motion ignored');
      if (await page.locator('#welcomeTitle').evaluate(node => getComputedStyle(node).animationName) !== 'none') throw new Error('Reduced motion title still animates');
      await page.emulateMedia({reducedMotion:'no-preference'});
      await send('ready');
      await motion('settled');
      await page.waitForFunction(() => document.querySelector('.welcomeMark').getAnimations().every(animation => animation.playState === 'finished'));
      if (await page.locator('.welcomePixel').first().evaluate(node => getComputedStyle(node).animationName) !== 'none') throw new Error('Logo keeps looping after ready');
      if (await page.locator('#prompt').inputValue() !== '保留输入中的草稿') throw new Error('Initialization lost draft');
      if (JSON.stringify(before) !== JSON.stringify(await page.locator('#welcome').boundingBox())) throw new Error('Ready welcome changed layout');
      await send('connecting');
      await motion('initializing');
      await page.evaluate(() => window.postMessage({...demo, phase:'disconnected', messages:[], notice:'连接失败，请重试。'}, '*'));
      await motion('idle');
      await page.getByRole('button', {name:'连接工作区', exact:true}).waitFor();
      if (await page.locator('.welcomePixel').first().evaluate(node => getComputedStyle(node).animationName) !== 'none') throw new Error('Failure kept initialization motion');
      await send('connecting');
      await motion('initializing');
      await send('disconnected'); // Cancellation retires the animation immediately.
      await motion('idle');
      await send('connecting');
      await motion('initializing');
      await page.evaluate(() => window.postMessage({...demo, phase:'connecting', messages:[{id:'saved', role:'user', label:'你', text:'已有消息'}]}, '*'));
      await page.locator('#welcome').waitFor({state:'hidden'});
      await page.locator('#workingRow').waitFor();
      if (await page.locator('#welcome').getAttribute('data-motion') !== 'idle') throw new Error('Hidden welcome retains animation');
      await send('ready');
      await motion('idle'); // A new context must not inherit a completion flash.
      await send('connecting');
      await page.reload();
      await motion('idle'); // Reload has no connection state until Host supplies it.
    }
    await page.goto('http://127.0.0.1:4318/?scenario=waitingForHost');
    await motion('idle');
    if (await page.locator('#welcome').getAttribute('aria-busy') !== 'false') throw new Error('Absent Host produced fake initialization');
    if (errors.length) throw new Error(errors.join('\n'));
    return 'WELCOME_MOTION_OK';
  } finally {
    page.off('pageerror', onError);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto(originalUrl);
  }
}
