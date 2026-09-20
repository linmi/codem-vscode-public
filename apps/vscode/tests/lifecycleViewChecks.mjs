export default async function lifecycleViewChecks(page) {
  // No Host snapshot is delivered: initial controls must already be correct.
  await page.goto('http://127.0.0.1:4318/?scenario=waitingForHost');
  await page.locator('.historyPaging').waitFor({state:'attached'});
  if(await page.locator('.historyPaging').isVisible() || await page.getByRole('button',{name:'加载更早消息',exact:true}).isVisible()) throw new Error('History paging flashed before Host state');
  await page.reload();
  await page.locator('.historyPaging').waitFor({state:'attached'});
  if(await page.locator('.historyPaging').isVisible()) throw new Error('Reload exposed paging without Host state');
  await page.goto('http://127.0.0.1:4318/?scenario=historyPaging');
  await page.getByRole('button',{name:'加载更早消息',exact:true}).waitFor();
  await page.goto('http://127.0.0.1:4318/?scenario=disconnected');
  await page.locator('.historyPaging').waitFor({state:'hidden'});
  await page.goto('http://127.0.0.1:4318/?scenario=firstSend');
  await page.locator('#prompt').fill('Immediate outgoing bubble');
  await page.locator('#send').click();
  const bubble = page.locator('#messages [data-role="user"]');
  await bubble.waitFor();
  if(await page.locator('.app').getAttribute('data-phase') !== 'connecting') throw new Error('Outgoing bubble waited for connection');
  await bubble.evaluate(node => { window.firstOutgoingBubble = node });
  const before = await bubble.boundingBox();
  await page.locator('.app[data-phase="running"]').waitFor();
  if(await bubble.count() !== 1 || !await bubble.evaluate(node => node === window.firstOutgoingBubble)) throw new Error('Connection replaced or duplicated the outgoing bubble');
  const after = await bubble.boundingBox();
  if(before.y !== after.y || before.height !== after.height) throw new Error('Outgoing bubble moved after connecting');
  await page.goto('http://127.0.0.1:4318/?scenario=disconnected');
  await page.locator('#welcome').waitFor();
  if(await page.locator('#transcriptLoading').isVisible() || await page.locator('#connection').isVisible()) throw new Error('Opening chat should not show connection UI');
  await page.locator('#prompt').fill('first message');
  if(!await page.locator('#send').isEnabled() || !await page.locator('#selectModel').isEnabled()) throw new Error('Disconnected chat must support demand-driven actions');
  await page.locator('#send').click(); // Fixture rejects; the pending draft must survive.
  if(await page.locator('#prompt').inputValue() !== 'first message') throw new Error('Failed first send lost draft');
  for(const phase of ['connecting','loadingHistory']) {
    await page.evaluate(phase=>window.postMessage({...demo,phase},'*'),phase);
    if(phase === 'connecting') {
      await page.locator('#workingRow').waitFor();
      if(await page.locator('#workingRow').textContent() !== '正在思考与处理…') throw new Error('Connection must use the processing indicator');
      if(await page.locator('#transcriptLoading').isVisible()) throw new Error('Connection shows a separate initialization screen');
    } else {
      await page.locator('#transcriptLoading').waitFor();
      if(await page.locator('#workingRow').isVisible()) throw new Error('History replay shows processing feedback');
    }
    if(await page.locator('#welcome').isVisible()) throw new Error('Loading flashed welcome');
    if(await page.locator('#connection').isVisible()) throw new Error('Connection actions duplicate loading feedback');
    if(await page.locator('.modelLoading').count() || (await page.locator('#status').textContent()).trim()) throw new Error('Duplicate connection/history loading announcement');
  }
  const saved = {id:'saved',role:'assistant',label:'CodeM',text:'Existing history'};
  await page.evaluate(saved=>window.postMessage({...demo,phase:'connecting',messages:[saved]},'*'),saved);
  await page.locator('#workingRow').waitFor();
  if(await page.locator('#transcriptLoading').isVisible()) throw new Error('Reconnect shows initialization screen');
  await page.getByText('Existing history',{exact:true}).waitFor();
  if(await page.locator('#connection').isVisible()) throw new Error('Reconnect duplicates loading feedback');
  await page.evaluate(saved=>window.postMessage({...demo,phase:'disconnected',messages:[saved],notice:'连接失败，请重试。'},'*'),saved);
  await page.getByRole('button',{name:'连接工作区',exact:true}).waitFor();
  await page.getByText('连接失败，请重试。',{exact:true}).waitFor();
  if(await page.locator('#transcriptLoading').isVisible()) throw new Error('Failed connection kept loading feedback');
  if(await page.locator('#workingRow').isVisible()) throw new Error('Failed connection kept processing feedback');
  if(!await page.locator('#connect').isEnabled()) throw new Error('Connection cannot be retried');
  for(const phase of ['sending','running','stopping']) {
    await page.evaluate(phase=>window.postMessage({...demo,phase},'*'),phase);
    await page.locator('#workingRow').waitFor();
    if(await page.locator('#transcriptLoading').isVisible()) throw new Error('Stale loading overlay');
  }
  await page.evaluate(()=>window.postMessage({...demo,phase:'ready'},'*'));
  await page.locator('#workingRow').waitFor({state:'hidden'});
  await page.locator('#welcome').waitFor();
  await page.evaluate(()=>window.postMessage({...demo,phase:'loadingHistory',messages:[{id:'saved',role:'assistant',label:'CodeM',text:'Existing history'}]},'*'));
  await page.getByText('Existing history',{exact:true}).waitFor();
  if(await page.locator('#messages').getAttribute('aria-busy')!=='true') throw new Error('Missing history busy state');
  return 'LIFECYCLE_VIEW_OK';
}
