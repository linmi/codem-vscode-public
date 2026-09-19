export default async function newSurfaceChecks(page) {
  await page.goto('http://127.0.0.1:4318/');
  if(await page.locator('pre .hljs-keyword').count()===0) throw new Error('Code is not highlighted');
  await page.getByRole('button',{name:'代码自动换行'}).click();
  if(await page.locator('.wrapCode').count()!==1) throw new Error('Code wrap toggle failed');
  await page.locator('#prompt').fill('/model');
  await page.getByRole('option',{name:/选择模型/}).waitFor();
  await page.locator('#prompt').press('Enter');
  await page.getByRole('dialog').waitFor();
  if(await page.locator('#prompt').inputValue()!=='') throw new Error('Local command was sent as a message');
  await page.getByRole('button',{name:'关闭菜单'}).click();
  await page.evaluate(()=> {
    demo.attachments=[{id:'image1',label:'example.png',kind:'image',preview:{kind:'image',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+1kAAAAASUVORK5CYII='}}];
    window.postMessage({...demo,phase:'configuring'},'*');
  });
  await page.locator('.attachmentThumbnail').waitFor();
  await page.evaluate(()=>window.postMessage({...demo,phase:'ready'},'*'));
  await page.getByRole('button',{name:'预览 example.png'}).click();
  await page.locator('dialog.imagePreview').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('dialog.imagePreview').waitFor({state:'detached'});
  if(await page.getByRole('button',{name:'移除附件 example.png'}).isDisabled()) throw new Error('Attachment remove stayed locked after loading');
  await page.evaluate(()=>window.postMessage({type:'panel',panel:{...panels.question,id:'restore-question',backChoiceId:'back',initialText:'Saved note',choices:panels.question.choices.map((c,i)=>({...c,selected:i===0}))}},'*'));
  if(await page.getByRole('textbox',{name:'补充回答'}).inputValue()!=='Saved note') throw new Error('Answer text not restored');
  if(await page.getByRole('button',{name:'提交回答'}).isDisabled()) throw new Error('Restored answer cannot submit');
  await page.getByRole('button',{name:'上一题'}).click();
  const reply=await page.evaluate(()=>window.panelReplies.at(-1));
  if(reply.choiceIds[0]!=='back'||reply.text!=='') throw new Error('Back payload invalid');
  await page.evaluate(()=>window.postMessage({type:'panel',panel:{...panels.plan,id:'plan-feedback',allowText:true}},'*'));
  await page.getByRole('textbox',{name:'修改意见'}).fill('Add tests');
  await page.getByRole('button',{name:/拒绝/}).click();
  const plan=await page.evaluate(()=>window.panelReplies.at(-1));
  if(plan.text!=='Add tests') throw new Error('Plan feedback lost');
  return 'NEW_SURFACES_OK';
}
