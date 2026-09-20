export default async function turnTimingChecks(page) {
  await page.goto('http://127.0.0.1:4318/?scenario=thinking');
  const header = page.locator('.workGroup > summary');
  await header.getByText(/已处理 \d+秒/).waitFor();
  if (await header.locator('.beautifulLoading').count()) throw new Error('Loading remains in turn header');
  await page.locator('.activityLoading .beautifulLoading').waitFor();
  const before = await header.innerText();
  await page.waitForFunction(before => document.querySelector('.workGroup > summary').innerText !== before, before);
  await header.click();
  await header.press('Enter');
  if (!(await header.innerText()).startsWith('已处理 ')) throw new Error('Collapse reset timer');
  await page.evaluate(() => {
    demo.phase='ready'; demo.turnTimings[0].finishedAt=demo.turnTimings[0].startedAt + 36_000;
    demo.messages.forEach(m=>{if('status' in m) m.status='completed'});
    window.postMessage(demo,'*');
  });
  await header.getByText('已处理 36秒',{exact:true}).waitFor();
  await page.locator('.activityLoading .beautifulLoading').waitFor({state:'detached'});
  await page.clock.install();
  await page.clock.fastForward(65_000);
  if (await header.innerText() !== '已处理 36秒') throw new Error('Completed timer kept ticking');
  // Re-render, as a webview snapshot restore would do, with unchanged timestamps.
  await page.evaluate(() => window.postMessage(demo,'*'));
  if (await header.innerText() !== '已处理 36秒') throw new Error('Restored duration changed');
  await page.evaluate(() => {
    demo.phase='running';
    demo.turnTimings.push({turnId:'second',startedAt:Date.now(),finishedAt:null});
    demo.messages.push({id:'u2',role:'user',label:'你',text:'下一轮',turnId:'second'}, {id:'r2',role:'reasoning',label:'思考过程',text:'',summary:'正在思考',status:'running',turnId:'second'});
    window.postMessage(demo,'*');
  });
  await page.locator('.workGroup').nth(1).locator(':scope > summary').getByText('已处理 0秒',{exact:true}).waitFor();
  if (await header.first().innerText() !== '已处理 36秒') throw new Error('New turn restarted old timer');
  await page.clock.fastForward(2000);
  await page.locator('.workGroup').nth(1).locator(':scope > summary').getByText('已处理 2秒',{exact:true}).waitFor();
  await page.evaluate(() => {demo.messages=[]; demo.turnTimings=[]; demo.phase='ready'; window.postMessage(demo,'*')});
  await page.locator('.workGroup').waitFor({state:'detached'});
  await page.clock.fastForward(5000);
  await page.clock.resume();
  await page.goto('http://127.0.0.1:4318/?scenario=thinking');
  return 'TURN_TIMING_OK';
}
