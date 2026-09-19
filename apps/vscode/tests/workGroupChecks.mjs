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
  await page.evaluate(() => {
    demo.messages = [
      {id:'user',role:'user',label:'你',text:'新闻'},
      {id:'tool1',role:'tool',label:'搜索',status:'completed',summary:'',text:'第一轮'},
      {id:'progress',role:'assistant',label:'CodeM',text:'调整查询关键词'},
      {id:'tool2',role:'tool',label:'搜索',status:'completed',summary:'',text:'第二轮'},
      {id:'final',role:'assistant',label:'CodeM',text:'最终答复'},
    ]; window.postMessage(demo,'*');
  });
  await page.getByText('最终答复',{exact:true}).waitFor();
  if(await page.locator('.workGroup').count() !== 1) throw new Error('Progress split one response into multiple groups');
  const combined = page.locator('.workGroup');
  await combined.locator(':scope > summary').click();
  await combined.getByText('调整查询关键词',{exact:true}).waitFor();
  if(await combined.getByText('最终答复',{exact:true}).count()) throw new Error('Final answer was folded into execution');

  await page.evaluate(() => {
    demo.phase = 'running';
    demo.messages[1] = {id:'tool1',role:'tool',label:'run_bash',status:'completed',summary:'',text:'Done',details:{kind:'command',code:'pnpm check',fields:[]}};
    window.postMessage(demo,'*');
  });
  await page.getByText('正在处理',{exact:true}).waitFor();
  await combined.getByText('已运行 pnpm check',{exact:true}).waitFor();
  if (await combined.locator('.messageActions:visible').count()) throw new Error('Progress has separate reply actions');
  await page.evaluate(() => { demo.phase='ready'; window.postMessage(demo,'*'); });
  await page.getByText('已处理',{exact:true}).waitFor();
  // A new user turn must not reopen or relabel the preceding response.
  await combined.locator(':scope > summary').click();
  await page.evaluate(() => {
    demo.messages.push({id:'newUser',role:'user',label:'你',text:'下一轮'});
    demo.phase='running'; window.postMessage(demo,'*');
  });
  await page.getByText('已处理',{exact:true}).waitFor();
  if (await combined.getAttribute('open') !== null) throw new Error('Historical group reopened for a new turn');
  return 'WORK_GROUP_OK';

}
