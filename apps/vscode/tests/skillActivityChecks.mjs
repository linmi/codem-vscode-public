export default async function skillActivityChecks(page) {
  await page.goto('http://127.0.0.1:4318/?scenario=conversation');
  await page.locator('#prompt').waitFor();
  await page.evaluate(() => {
    window.demo.phase = 'running';
    window.demo.messages = [{ id:'skill', turnId:'previewTurn', role:'tool', label:'skill', status:'running', summary:'', text:'', details:{kind:'skill',code:null,fields:[{label:'技能',value:'codem-plugin:codem-wiki'},{label:'插件',value:'codem-plugin'}]} }];
    window.dispatchEvent(new MessageEvent('message',{data:structuredClone(window.demo)}));
  });
  const tool = page.locator('.activityMessage[data-tool="skill"]');
  await tool.locator('.activityTitle').getByText('正在加载技能 codem-plugin:codem-wiki',{exact:true}).waitFor();
  await tool.locator('summary').click();
  await tool.getByText('技能加载结果',{exact:true}).waitFor();
  await tool.getByText('正在加载技能说明…',{exact:true}).waitFor();
  await tool.locator('.toolInputField').getByText('codem-plugin',{exact:true}).waitFor();
  for (const [status,title] of [['completed','已加载技能'],['failed','加载技能失败'],['declined','已拒绝加载技能'],['interrupted','已停止加载技能'],['incomplete','技能加载未完成']]) {
    await page.evaluate(({status}) => {
      window.demo.messages[0].status = status;
      window.demo.messages[0].text = status === 'failed' ? '<script>window.skillInjected=true</script>\nUnknown skill' : 'Skill loaded.';
      window.dispatchEvent(new MessageEvent('message',{data:structuredClone(window.demo)}));
    },{status});
    await tool.locator('.activityTitle').getByText(`${title} codem-plugin:codem-wiki`,{exact:true}).waitFor();
    if (!await tool.locator('details').evaluate(node => node.open)) throw Error('Status update closed the skill details');
    if (await page.evaluate(() => window.skillInjected)) throw Error('Skill output executed as markup');
  }
  await page.setViewportSize({width:420,height:800});
  await page.evaluate(() => {
    window.demo.messages[0].details.fields[0].value = 'plugin:' + 'long-skill-name-'.repeat(12);
    window.dispatchEvent(new MessageEvent('message',{data:structuredClone(window.demo)}));
  });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Long skill name overflows narrow view');
  await page.evaluate(() => {
    window.demo.messages[0].details = undefined;
    window.demo.messages[0].status = 'running';
    window.dispatchEvent(new MessageEvent('message',{data:structuredClone(window.demo)}));
  });
  await tool.locator('.activityTitle').getByText('正在加载技能',{exact:true}).waitFor();
  if (await tool.locator('.toolInputField').count()) throw Error('Missing input retained stale skill metadata');
  await page.reload();
  if (await page.locator('.activityMessage[data-tool="skill"]').count()) throw Error('Fixture state survived reload');
  return 'SKILL_ACTIVITY_OK';
}
