export default async function artifactCardsChecks(page) {
  await page.goto('http://127.0.0.1:4318/');
  await page.evaluate(() => {
    demo.messages = [
      {id:'command',role:'tool',label:'run_bash',status:'failed',summary:'exit 1',text:'Failed',details:{kind:'command',fields:[],code:'pnpm check'},artifacts:[{id:'diff',kind:'diff',title:'main.ts',detail:'+1 −0',available:true}]},
      {id:'reply',role:'assistant',label:'CodeM',text:'报告',artifacts:[{id:'file',kind:'file',title:'报告.txt',detail:'报告.txt',available:true},{id:'blocked',kind:'url',title:'不可用链接',detail:'不支持的地址',available:false}]},
    ];
    window.postMessage(demo,'*');
  });
  await page.getByText('pnpm check',{exact:true}).waitFor();
  if(!await page.getByRole('button',{name:'打开产物 不可用链接'}).isDisabled()) throw new Error('Unsafe artifact is clickable');
  await page.getByRole('button',{name:'打开差异 main.ts'}).click();
  await page.getByRole('button',{name:'打开产物 报告.txt'}).click();
  const actions = await page.evaluate(() => window.viewActions.filter(action => ['openDiff','openArtifact'].includes(action.type)));
  if(JSON.stringify(actions)!==JSON.stringify([{type:'openDiff',id:'diff'},{type:'openArtifact',id:'file'}])) throw new Error('Artifact sends more than opaque handles');
  return 'ARTIFACT_ACTIONS_OK';
}
