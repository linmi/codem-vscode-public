// Playwright CLI function, against tests/webviewPreview.ts only.
export default async function panelViewChecks(page) {
  await page.goto('http://127.0.0.1:4318/?panel=model');
  await page.getByRole('combobox',{name:'搜索模型'}).fill('Reasoning');
  await page.getByRole('combobox',{name:'搜索模型'}).press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const model = await page.evaluate(() => window.viewActions.filter(action => action.type === 'chooseModel'));
  if(model.length!==1||model[0].id!=='model-one') throw new Error('Model selection failed');
  await page.getByRole('button',{name:'选择模型',exact:true}).click();
  await page.getByRole('combobox',{name:'搜索模型'}).press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  if(!(await page.locator('#selectModel').evaluate(node=>node===document.activeElement))) throw new Error('Picker focus not restored');
  await page.goto('http://127.0.0.1:4318/?panel=question');
  if(!(await page.locator('#prompt').isDisabled())) throw new Error('Question must prevent background composer submission');
  if(!(await page.getByRole('button',{name:'提交回答',exact:true}).isDisabled())) throw new Error('Empty question answer was enabled');
  await page.getByRole('button',{name:/聊天界面/}).click();
  await page.getByRole('button',{name:/输入区域/}).click();
  await page.getByRole('textbox',{name:'补充回答'}).fill('Keep keyboard access');
  await page.getByRole('button',{name:'提交回答',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const question = await page.evaluate(() => window.panelReplies);
  if(question.length!==1||question[0].choiceIds.length!==2||question[0].text!=='Keep keyboard access') throw new Error('Multi-select and free text not preserved');
  await page.goto('http://127.0.0.1:4318/?panel=approval&theme=dark');
  await page.getByRole('dialog').press('2');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const approval = await page.evaluate(() => window.panelReplies);
  if(approval.length!==1||approval[0].choiceIds[0]!=='session') throw new Error('Approval shortcut mapping failed');
  await page.goto('http://127.0.0.1:4318/?panel=plan');
  await page.getByRole('button',{name:/拒绝/}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const plan = await page.evaluate(() => window.panelReplies);
  if(plan[0]?.choiceIds[0]!=='decline') throw new Error('Plan rejection failed');
  return {status:'PANEL_UI_OK',model,question,approval,plan};
}
