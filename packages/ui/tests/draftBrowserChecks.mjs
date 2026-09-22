/** Run against the built index.html in an existing Playwright page; uses fixture snapshots only. */
export async function verifyDraftLifecycle(page) {
  await page.evaluate(() => {
    window.__reviewActions = [];
    window.addEventListener("message", event => {
      if (event.data?.source === "codem-ui") window.__reviewActions.push(event.data.action);
    });
    window.__reviewState = {
      type: "state", phase: "ready", workspace: "Regression fixture", space: "Test space",
      threadId: null, model: "fixture", effort: "medium", permission: "auto", workMode: "default",
      notice: null, version: 1, theme: "light", hasOlderMessages: false,
      historyNeedsRefresh: false, assistantText: "", messages: [],
      account: { status: "signedIn", refreshing: false, notice: null,
        profile: { displayName: "Fixture", userId: "fixture", avatar: { kind: "none" } } },
    };
    window.__codemHostReceive(JSON.stringify(window.__reviewState));
  });

 const input = page.getByRole('textbox', {name:'发送给 CodeM 的消息'});
 const send = page.getByRole('button', {name:'发送消息', exact:true});
 const original = '  回归：保留我的草稿\n';
 await input.fill(original);
 await send.click();
 await page.waitForFunction(() => window.__reviewActions.some(a => a.type === 'send'));
 const id = await page.evaluate(() => window.__reviewActions.findLast(a => a.type === 'send').requestId);
 await page.evaluate(id => {
   window.__reviewState = {...window.__reviewState,phase:'sending',version:2,messages:[{id,role:'user',text:'回归：保留我的草稿'}]};
   window.__codemHostReceive(JSON.stringify(window.__reviewState));
 }, id);
 if (await input.inputValue() !== original) throw new Error('Draft cleared on optimistic message');
 if (await page.evaluate(() => sessionStorage.getItem('codem.draft')) !== original) throw new Error('Draft not saved across reload');
 await page.evaluate(id => {
   window.__reviewState = {...window.__reviewState,phase:'ready',version:3,messages:[],notice:'Fixture turn/start rejected',submission:{requestId:id,accepted:false}};
   window.__codemHostReceive(JSON.stringify(window.__reviewState));
 }, id);
 await send.waitFor({state:'visible'});
 await page.waitForFunction(() => !document.querySelector('#send').disabled);
 if (await input.inputValue() !== original) throw new Error('Draft lost on rejection');
 await send.click();
 await page.waitForFunction(previous => window.__reviewActions.findLast(action => action.type === 'send')?.requestId !== previous, id);
 const id2 = await page.evaluate(() => window.__reviewActions.findLast(a => a.type === 'send').requestId);
 if(id === id2) throw new Error('Retry reused request id');
 await page.evaluate(id => window.__codemHostReceive(JSON.stringify({...window.__reviewState,notice:null,version:4,submission:{requestId:id,accepted:true}})), id2);
 await page.waitForFunction(() => document.querySelector('#prompt').value === '');
 if(await page.evaluate(() => sessionStorage.getItem('codem.draft')) !== null) throw new Error('Accepted draft persisted');
 await input.fill('原消息');
 await send.click();
 await page.waitForFunction(previous => window.__reviewActions.findLast(action => action.type === 'send')?.requestId !== previous, id2);
 const id3 = await page.evaluate(() => window.__reviewActions.findLast(a => a.type === 'send').requestId);
 await input.fill('新的草稿');
 await page.evaluate(id => window.__codemHostReceive(JSON.stringify({...window.__reviewState,notice:'Fixture failure',version:5,submission:{requestId:id,accepted:false}})), id3);
 await page.waitForFunction(() => !document.querySelector('#send').disabled);
 if(await input.inputValue() !== '新的草稿') throw new Error('Rejection overwrote newer text');
 const state = await page.evaluate(() => window.__reviewState);
 await page.reload();
 await page.getByRole('region', {name:'登录 CodeM'}).waitFor();
 await page.evaluate(state => window.__codemHostReceive(JSON.stringify({...state,phase:'ready',notice:null,submission:null,messages:[]})), state);
 await input.waitFor({state:'visible'});
 if(await input.inputValue() !== '新的草稿') throw new Error('Reload lost draft');
 console.log('PASS: optimistic message, rejection, retry acknowledgement, newer text, reload');
}
