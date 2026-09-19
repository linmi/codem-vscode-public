export default async function lifecycleViewChecks(page) {
  await page.goto('http://127.0.0.1:4318/?empty=1');
  for(const phase of ['connecting','loadingHistory']) {
    await page.evaluate(phase=>window.postMessage({...demo,phase},'*'),phase);
    await page.locator('#transcriptLoading').waitFor();
    if(await page.locator('#welcome').isVisible()) throw new Error('Loading flashed welcome');
  }
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
