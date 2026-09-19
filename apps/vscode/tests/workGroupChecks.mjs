export default async function workGroupChecks(page) {
  await page.goto('http://127.0.0.1:4318/');
  const group = page.locator('.workGroup');
  await group.waitFor();
  if(await group.getAttribute('open')!==null) throw new Error('Settled work must start collapsed');
  await group.locator(':scope > summary').click();
  if(await group.locator('.activityMessage').count()!==2) throw new Error('Missing grouped work');
  await page.evaluate(() => { demo.messages[1].text += ' updated'; window.postMessage(demo,'*'); });
  if(await group.getAttribute('open')===null) throw new Error('User expansion was lost');
  await page.evaluate(() => { demo.messages=[]; window.postMessage(demo,'*'); });
  await group.waitFor({state:'detached'});
  await page.evaluate(() => { demo.messages=[{id:'r2',role:'reasoning',label:'思考过程',status:'running',summary:'',text:'Thinking'},{id:'a2',role:'assistant',label:'CodeM',text:'Done'}]; window.postMessage(demo,'*'); });
  await page.locator('.workGroup[open]').waitFor();
  await page.evaluate(() => { demo.messages[0].status='completed'; window.postMessage(demo,'*'); });
  await page.locator('.workGroup:not([open])').waitFor();
  return 'WORK_GROUP_OK';
}
