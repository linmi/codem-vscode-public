export default async function imagePasteChecks(page) {
  await page.goto('http://127.0.0.1:4318/?scenario=conversation');
  await page.locator('#prompt').waitFor();
  if (await page.locator('#notice').isVisible()) throw Error('Paste feedback must be hidden initially');
  await page.locator('#prompt').fill('请解释截图');
  const paste = (options = {}) => page.evaluate(options => {
    const transfer = new DataTransfer();
    if (options.text) transfer.setData('text/plain', options.text);
    if (!options.textOnly) {
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
      const context = canvas.getContext('2d'); context.fillStyle = '#ff0000'; context.fillRect(0, 0, 16, 16);
      const base64 = canvas.toDataURL('image/png').split(',')[1];
      const bytes = options.oversize ? new Uint8Array(20 * 1024 * 1024 + 1) : Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], 'clipboard.png', { type: options.type || 'image/png' }));
    }
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
    document.querySelector('#prompt').dispatchEvent(event);
    return { prevented: event.defaultPrevented, disabled: document.querySelector('#send').disabled };
  }, options);
  const before = await page.evaluate(() => window.viewActions.filter(a => a.type === 'pasteImages').length);
  if ((await paste({text:'普通文字', textOnly:true})).prevented) throw Error('Text paste was intercepted');
  if (await page.evaluate(() => window.viewActions.filter(a => a.type === 'pasteImages').length) !== before) throw Error('Text paste posted images');

  // Delay Host's receipt: image decoding must not let Enter race ahead of attachment acceptance.
  await page.evaluate(() => {
    window.holdPasteReceipt = true;
    const dispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = event => {
      if (window.holdPasteReceipt && event.data?.type === 'pasteImagesResult') {
        window.heldPasteReceipt = event.data; return true;
      }
      return dispatch(event);
    };
  });
  const first = await paste();
  if (!first.prevented || !first.disabled) throw Error('Image paste did not reserve the submission');
  await page.waitForFunction(() => window.heldPasteReceipt);
  if (!await page.locator('#send').isDisabled()) throw Error('Send enabled before Host receipt');
  await page.locator('#prompt').press('Enter');
  if (await page.evaluate(() => window.viewActions.some(a => a.type === 'send'))) throw Error('Enter submitted before paste completed');
  await page.evaluate(() => {
    window.holdPasteReceipt = false;
    window.dispatchEvent(new MessageEvent('message', {data: window.heldPasteReceipt}));
  });
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  if (await page.locator('#prompt').inputValue() !== '请解释截图') throw Error('Paste consumed the text draft');
  await page.waitForFunction(() => document.querySelector('#attachments img')?.naturalWidth === 16);
  await page.getByRole('button', {name:'预览 粘贴图片.png',exact:true}).click();
  await page.getByRole('dialog', {name:'粘贴图片.png'}).waitFor();
  await page.getByRole('button', {name:'关闭预览',exact:true}).click();
  await page.getByRole('button', {name:'移除附件 粘贴图片.png',exact:true}).click();
  if (await page.locator('#attachments .attachmentCard').count()) throw Error('Removal left an attachment');

  await paste({type:'image/svg+xml'});
  await page.getByText('请复制 PNG、JPEG、GIF 或 WebP 图片。', {exact:true}).waitFor();
  await paste({oversize:true});
  await page.getByText('单次粘贴的图片合计不能超过 20 MiB。', {exact:true}).waitFor();
  if (await page.locator('#send').isDisabled()) throw Error('Rejected paste kept composer busy');
  if ((await paste({text:'保留这段文字'})).prevented) throw Error('Mixed text/image paste lost native text insertion');
  await page.waitForFunction(() => document.querySelector('#attachments img')?.naturalWidth === 16);
  await page.getByRole('button', {name:'移除附件 粘贴图片.png',exact:true}).click();

  // Context changes invalidate FileReader work before any bytes reach Host.
  const posted = await page.evaluate(() => window.viewActions.filter(a => a.type === 'pasteImages').length);
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function(file) { window.releasePasteRead = () => original.call(this, file); };
    window.restorePasteReader = () => { FileReader.prototype.readAsDataURL = original; };
  });
  await paste();
  await page.evaluate(() => {
    window.demo.threadId = 'another-thread';
    window.dispatchEvent(new MessageEvent('message', {data: structuredClone(window.demo)}));
    window.restorePasteReader(); window.releasePasteRead();
  });
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  // Let the invalidated reader's load event run before checking for a stale send.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (await page.evaluate(() => window.viewActions.filter(a => a.type === 'pasteImages').length) !== posted) throw Error('Stale clipboard bytes reached the next conversation');
  await paste();
  await page.waitForFunction(() => document.querySelector('#attachments img')?.naturalWidth === 16);
  await page.reload();
  await page.locator('#prompt').waitFor();
  if (await page.locator('#notice').isVisible()) throw Error('Reload retained a stale paste operation');
  return 'image paste, thumbnail/dialog, removal, text/mixed paste, size/type errors, pending receipt and context cancellation passed';
}
