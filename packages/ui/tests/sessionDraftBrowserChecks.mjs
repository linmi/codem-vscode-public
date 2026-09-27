/** Run against the built index.html in an existing Playwright page; uses fixture snapshots only, no Core. */
export async function verifySessionDrafts(page) {
  await page.evaluate(() => {
    window.__reviewActions = [];
    window.addEventListener("message", event => {
      if (event.data?.source === "codem-ui") window.__reviewActions.push(event.data.action);
    });
    window.__reviewVersion = 0;
    window.__reviewShow = patch => {
      window.__reviewState = { ...window.__reviewState, ...patch, version: ++window.__reviewVersion };
      window.__codemHostReceive(JSON.stringify(window.__reviewState));
    };
    window.__reviewState = {
      type: "state", phase: "ready", workspace: "Regression fixture", space: "Test space",
      threadId: "a", model: "fixture", effort: "medium", permission: "auto", workMode: "default",
      notice: null, hasOlderMessages: false, historyNeedsRefresh: false, assistantText: "", messages: [],
      account: { status: "signedIn", refreshing: false, notice: null,
        profile: { displayName: "Fixture", userId: "fixture", avatar: { kind: "none" } } },
    };
    window.__reviewShow({});
  });
  const input = page.getByRole("textbox", { name: "发送给 CodeM 的消息" });
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  const show = patch => page.evaluate(patch => window.__reviewShow(patch), patch);
  const expectDraft = async (text, message) => {
    await page.waitForFunction(text => document.querySelector("#prompt")?.value === text, text, { timeout: 2000 })
      .catch(async () => { throw new Error(`${message}: got ${JSON.stringify(await input.inputValue())}`) });
  };
  const lastSend = () => page.evaluate(() => window.__reviewActions.findLast(action => action.type === "send")?.requestId);
  const sendNow = async () => {
    const previous = await lastSend();
    await send.click();
    await page.waitForFunction(previous => window.__reviewActions.findLast(action => action.type === "send")?.requestId !== previous, previous);
    return lastSend();
  };

  await input.fill("A 的草稿");
  await show({ phase: "loadingHistory" });
  await show({ phase: "ready", threadId: "b" });
  await expectDraft("", "Switching to thread b leaked thread a's draft");
  await input.fill("B 的草稿");
  // Reconnecting passes through a null thread; that is not a switch to a new chat.
  await show({ phase: "connecting", threadId: null });
  await expectDraft("B 的草稿", "A reconnect moved the draft away");
  await show({ phase: "ready", threadId: "b" });
  await expectDraft("B 的草稿", "Reconnecting to the same thread lost its draft");
  await show({ threadId: "a" });
  await expectDraft("A 的草稿", "Returning to thread a did not bring back its draft");

  // A new chat has its own draft; its first message creates the thread and takes the draft with it.
  await show({ threadId: null });
  await expectDraft("", "A new chat showed another session's draft");
  await input.fill("新会话第一条");
  const first = await sendNow();
  await show({ phase: "sending", threadId: "c" });
  await expectDraft("新会话第一条", "The pending first message left its new thread");
  await show({ phase: "ready", submission: { requestId: first, accepted: true } });
  await expectDraft("", "The accepted first message stayed in the composer");
  await show({ threadId: null });
  await expectDraft("", "The sent first message came back in the next new chat");

  // A receipt that arrives after the user switched away settles the sending session only.
  await show({ threadId: "a" });
  await expectDraft("A 的草稿", "Thread a lost its draft");
  const rejected = await sendNow();
  await show({ threadId: "b" });
  await expectDraft("B 的草稿", "Switching during a pending send showed the wrong draft");
  await show({ submission: { requestId: rejected, accepted: false }, notice: "Fixture rejection" });
  await expectDraft("B 的草稿", "A late rejection wrote thread a's text into thread b");
  await show({ threadId: "a", notice: null });
  await expectDraft("A 的草稿", "A rejected send did not keep thread a's draft");
  const accepted = await sendNow();
  await show({ threadId: "b" });
  await show({ submission: { requestId: accepted, accepted: true } });
  await expectDraft("B 的草稿", "A late acceptance cleared thread b");
  await show({ threadId: "a" });
  await expectDraft("", "An accepted send left its text in thread a");
  await input.fill("A 的新草稿");

  // Reload restores both the current draft and the stashed ones.
  const state = await page.evaluate(() => window.__reviewState);
  await page.reload();
  await page.evaluate(state => window.__codemHostReceive(JSON.stringify({ ...state, version: 1, submission: null })), state);
  await expectDraft("A 的新草稿", "Reload lost the current session's draft");
  await page.evaluate(state => window.__codemHostReceive(JSON.stringify({ ...state, version: 2, submission: null, threadId: "b" })), state);
  await expectDraft("B 的草稿", "Reload lost another session's draft");
  console.log("PASS: switch, reconnect, new chat first message, late receipts, reload");
}
