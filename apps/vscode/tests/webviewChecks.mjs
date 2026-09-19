// Run with the Playwright CLI against tests/webviewPreview.ts; see docs/synaraStyleAlignment.md.
export default async function webviewChecks(page) {
  await page.goto("http://127.0.0.1:4318/");
  const result = await page.evaluate(async () => {
    const text = '## Render check\n\n- **Bold**\n- `inline`\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = "<script>safe code</script>"\n```\n\n<script>window.__xss = true</script><img src=x onerror="window.__xss=true"><svg onload="window.__xss=true"></svg><form><input autofocus onfocus="window.__xss=true"></form>\n\n[unsafe](command:codem.connect) [safe](https://example.com)';
    window.postMessage({...demo, messages:[{id:'safety',role:'assistant',label:'CodeM',text}]}, '*');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const body = document.querySelector('.chatMarkdown');
    const result = {heading:body.querySelector('h2')?.textContent, listItems:body.querySelectorAll('li').length, tableCells:body.querySelectorAll('td').length, code:body.querySelector('pre')?.textContent, unsafeElements:body.querySelectorAll('script,img,svg,form,iframe,object,style').length, unsafeLinks:[...body.querySelectorAll('a[href]')].filter(a=>!a.href.startsWith('https://')).length, link:body.querySelector('a[href]')?.href, injected:window.__xss===true, width:innerWidth, scrollWidth:document.body.scrollWidth};
    // UI-owned copy icons are the only allowed SVG nodes after sanitizing model content.
    result.unsafeElements -= body.querySelectorAll('.codeHeader svg').length;
    return result;
  });
  if(result.heading!=='Render check'||result.listItems!==2||result.tableCells!==2||result.unsafeElements||result.unsafeLinks||result.injected||!result.code.includes('<script>safe code</script>')) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify(result));
  await page.evaluate(() => window.postMessage(demo,'*'));
  await page.locator('.workGroup > summary').click();
  await page.getByText('读取文件 · auth.ts',{exact:true}).click();
  const expanded = await page.locator('.activityMessage[data-role="tool"] details').getAttribute('open');
  if(expanded===null) throw new Error('Tool output did not expand');
  await page.evaluate(() => window.postMessage({...demo,messages:demo.messages.map(m=>m.id==='t'?{...m,text:m.text+'\nstream update'}:m)},'*'));
  if(await page.locator('.activityMessage[data-role="tool"] details').getAttribute('open')===null) throw new Error('Delta collapsed tool details');
  await page.getByRole('button',{name:'文件与工具',exact:true}).click();
  await page.getByRole('button',{name:'关闭文件与工具'}).press('Escape');
  if(await page.locator('#activityPanel').isVisible()) throw new Error('Escape did not close resources');
  if(!(await page.locator('#toggleResources').evaluate(node=>node===document.activeElement))) throw new Error('Resource focus not restored');
  await page.getByRole('button',{name:'历史会话',exact:true}).click();
  await page.getByRole('button',{name:'关闭',exact:true}).press('Escape');
  await page.locator('#historyPanel').waitFor({state:'hidden'});
  if(!(await page.getByRole('button',{name:'历史会话',exact:true}).evaluate(node=>node===document.activeElement))) throw new Error('History focus not restored');
  await page.evaluate(() => window.postMessage({...demo,messages:[{id:'long',role:'assistant',label:'CodeM',text:'Scroll verification paragraph.\n\n'.repeat(100)}]},'*'));
  await page.locator('#scrollArea').evaluate(node => { node.scrollTop=0; node.dispatchEvent(new Event('scroll')); });
  await page.getByRole('button',{name:'回到最新消息'}).click();
  if(await page.locator('#jumpLatest').isVisible()) throw new Error('Jump did not reach latest');
  await page.evaluate(() => window.postMessage({...demo,threadId:null,messages:[]},'*'));
  await page.locator('#welcome').waitFor({state:'visible'});
  await page.evaluate(() => window.postMessage(demo,'*'));
  await page.getByRole('textbox',{name:'发送给 CodeM 的消息'}).fill('A long wrapped composer draft. '.repeat(60));
  const expandedHeight = await page.locator('#prompt').evaluate(node=>node.getBoundingClientRect().height);
  if(expandedHeight <= 59 || expandedHeight > 220) throw new Error('Composer does not grow within its bounds');
  await page.getByRole('textbox',{name:'发送给 CodeM 的消息'}).fill('');
  const emptyHeight = await page.locator('#prompt').evaluate(node=>node.getBoundingClientRect().height);
  if(emptyHeight !== 59) throw new Error('Composer did not return to two lines');
  return { status: 'WEBVIEW_CHECKS_OK', safety: result, interactions: ['tool expansion across updates', 'resource Escape and focus', 'history Escape and focus', 'jump to latest', 'empty state', 'composer autosize'] };
}
