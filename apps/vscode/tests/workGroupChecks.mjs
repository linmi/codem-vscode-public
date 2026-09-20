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
  if(await page.locator('.workGroup').count() !== 1) throw new Error('Progress text split one turn into multiple processing groups');
  const first = page.locator('.workGroup').first();
  if (await page.locator('#messages > .message[data-role="assistant"]').count() !== 1) throw new Error('Progress was left outside processing');
  if (await first.getByText('调整查询关键词',{exact:true}).isVisible()) throw new Error('Collapsed progress remains visible');
  await first.locator(':scope > summary').click();
  await first.getByText('调整查询关键词',{exact:true}).waitFor();
  if (await first.locator('.activityMessage').count() !== 2) throw new Error('One turn did not retain both tool records');
  await first.locator('.activityMessage summary').first().click();
  await first.getByText('第一轮',{exact:true}).waitFor();
  await first.locator(':scope > summary').press('Enter');
  await first.getByText('调整查询关键词',{exact:true}).waitFor({state:'hidden'});
  await page.locator('#messages > .message').getByText('最终答复',{exact:true}).waitFor();

  await page.evaluate(() => {
    demo.phase = 'running';
    demo.messages[3] = {id:'tool2',role:'tool',label:'run_bash',status:'completed',summary:'',text:'Done',details:{kind:'command',code:'pnpm check',fields:[]}};
    window.postMessage(demo,'*');
  });
  await first.getByText('正在处理',{exact:true}).waitFor();
  if (await first.getAttribute('open') !== null) throw new Error('Appending work lost the user collapse state');
  await first.locator(':scope > summary').click();
  await first.getByText('已运行 pnpm check',{exact:true}).waitFor();
  await first.locator(':scope > summary').click();
  if (await page.locator('#messages > .message[data-role="assistant"] .messageActions:visible').count() !== 1) throw new Error('Final reply lost its actions');
  await page.evaluate(() => { demo.phase='ready'; window.postMessage(demo,'*'); });
  await first.getByText('已处理',{exact:true}).waitFor();
  // A new user turn must not reopen or relabel preceding execution groups.
  await page.evaluate(() => {
    demo.messages.push({id:'newUser',role:'user',label:'你',text:'下一轮'});
    demo.phase='running'; window.postMessage(demo,'*');
  });
  if (await page.locator('.workGroup[open]').count()) throw new Error('Historical groups reopened for a new turn');
  await page.goto('http://127.0.0.1:4318/?scenario=progressUpdates');
  if (await page.locator('#messages > .message[data-role="assistant"]').count() !== 1) throw new Error('Intermediate progress left a separate reply gap');
  await page.locator('.workGroup > summary').click();
  await page.locator('.workGroup').getByText('暂未获取城市，先检索国内要闻。',{exact:true}).waitFor();
  if (await page.locator('.workGroup').count() !== 1) throw new Error('Persisted progress scenario split one processing group');
  if (await page.locator('.workGroup > summary').filter({hasText:/已处理 \d+秒/}).count() !== 1) throw new Error('One turn duration was duplicated across execution groups');
  // A streaming explanation starts outside, then moves into the same collapsed group.
  await page.evaluate(() => {
    demo.phase = 'running';
    demo.messages = [
      {id:'u-stream',role:'user',label:'你',text:'进度'},
      {id:'t-stream',role:'tool',label:'搜索',status:'completed',summary:'',text:'结果'},
      {id:'p-stream',role:'assistant',label:'CodeM',text:'Wiki 未命中，继续检查代码库。'},
    ]; window.postMessage(demo,'*');
  });
  await page.locator('#messages > .message').getByText('Wiki 未命中，继续检查代码库。',{exact:true}).waitFor();
  await page.locator('.workGroup > summary').click();
  await page.evaluate(() => {
    window.progressNode = document.querySelector('#messages > .message[data-role="assistant"]');
    window.workNode = document.querySelector('.workGroup');
    demo.messages.push(
      {id:'t-next',role:'tool',label:'读取',status:'completed',summary:'',text:'结果'},
      {id:'a-final',role:'assistant',label:'CodeM',text:'这是最终的项目进展。'},
    ); window.postMessage(demo,'*');
  });
  await page.locator('#messages > .message').getByText('这是最终的项目进展。',{exact:true}).waitFor();
  if (await page.locator('#messages > .message[data-role="assistant"]').count() !== 1) throw new Error('Progress left a top-level message gap');
  if (!await page.evaluate(() => document.querySelector('.workGroup') === window.workNode && window.workNode.contains(window.progressNode) && !window.workNode.open)) throw new Error('Moving progress replaced the group or lost its collapse state');
  await page.locator('.workGroup > summary').click();
  await page.locator('.workGroup').getByText('Wiki 未命中，继续检查代码库。',{exact:true}).waitFor();
  for (const dark of [false, true]) {
    await page.evaluate(dark => { document.body.classList.toggle('vscode-dark', dark); document.body.classList.toggle('vscode-light', !dark); }, dark);
    const presentation = await page.locator('.workGroupContent .message[data-role="assistant"]').evaluate(node => {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return {
        color: getComputedStyle(node.querySelector('.messageBody')).color,
        bodyColor: getComputedStyle(document.body).color,
        toolColor: getComputedStyle(node.previousElementSibling.querySelector('summary')).color,
        top: parseFloat(style.marginTop), bottom: parseFloat(style.marginBottom),
        before: bounds.top - node.previousElementSibling.getBoundingClientRect().bottom,
        after: node.nextElementSibling.getBoundingClientRect().top - bounds.bottom,
      };
    });
    if (presentation.color !== presentation.bodyColor || presentation.color === presentation.toolColor) throw new Error('Progress explanation must use the main text color in both themes');
    if ([presentation.top, presentation.bottom, presentation.before, presentation.after].some(gap => gap < 8)) throw new Error('Progress explanation lost spacing around tool records');
  }
  return 'WORK_GROUP_OK';

}
