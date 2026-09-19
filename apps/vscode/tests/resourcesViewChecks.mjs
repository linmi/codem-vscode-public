export default async function resourcesViewChecks(page) {
  await page.goto('http://127.0.0.1:4318/');
  await page.getByRole('button',{name:'历史会话',exact:true}).click();
  await page.getByRole('searchbox',{name:'搜索已加载的会话'}).fill('missing');
  await page.getByText('没有匹配的会话',{exact:true}).waitFor();
  if(await page.locator('.historyEntry').count()) throw new Error('Search did not filter');
  await page.getByRole('searchbox',{name:'搜索已加载的会话'}).fill('登录');
  await page.locator('.historyEntry').waitFor();
  await page.getByRole('searchbox',{name:'搜索已加载的会话'}).press('Escape');
  await page.getByRole('button',{name:'文件与工具',exact:true}).click();
  await page.getByRole('tab',{name:'工具',exact:true}).click();
  await page.locator('#toolsSection').waitFor();
  if(await page.locator('#filesSection').isVisible()) throw new Error('Inactive tab visible');
  await page.getByRole('tab',{name:'工具',exact:true}).press('ArrowLeft');
  await page.locator('#backgroundSection').waitFor();
  return 'RESOURCES_VIEW_OK';
}
