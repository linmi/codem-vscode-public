export default async function replyPreservationChecks(page) {
  for (const theme of ['dark', 'light']) {
    await page.goto(`http://127.0.0.1:4318/?theme=${theme}`);
    await page.locator('#prompt').waitFor();
    await page.evaluate(() => {
      demo.messages = [
        { id: 'user', role: 'user', label: '你', text: '你的工具呢？' },
        { id: 'reasoning', role: 'reasoning', label: '思考过程', status: 'completed', summary: '', text: 'Fixture reasoning' },
        { id: 'answer', role: 'assistant', label: 'CodeM', text: '可用工具：\n- `read_files`\n- `run_bash`\n- `tool_search`' },
      ];
      demo.phase = 'ready';
      window.postMessage(demo, '*');
    });
    // A natural text completion remains fully visible outside the work group.
    await page.locator('#messages > .message').getByText('read_files', { exact: true }).waitFor();
    await page.evaluate(() => {
      demo.messages.push({ id: 'structured', role: 'assistant', label: 'CodeM', text: '已说明可用工具清单。' });
      window.postMessage(demo, '*');
    });
    await page.getByText('已说明可用工具清单。', { exact: true }).waitFor();
    const group = page.locator('.workGroup');
    await group.locator(':scope > summary').click();
    for (const tool of ['read_files', 'run_bash', 'tool_search']) {
      await group.getByText(tool, { exact: true }).waitFor();
    }
    // A repeated snapshot must neither erase the reply nor reset expansion.
    await page.evaluate(() => window.postMessage(demo, '*'));
    await group.getByText('read_files', { exact: true }).waitFor();
    if (await page.getByText('已说明可用工具清单。', { exact: true }).count() !== 1) throw new Error('Duplicate structured delivery');
    await page.evaluate(() => {
      demo.messages = [{ id: 'next', role: 'user', label: '你', text: '新会话' }];
      window.postMessage(demo, '*');
    });
    await page.getByText('read_files', { exact: true }).waitFor({ state: 'detached' });
  }
  return 'REPLY_PRESERVATION_OK';
}
