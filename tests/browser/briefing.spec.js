import { test, expect } from '@playwright/test'

const url = 'https://orbit.example/'
const events = [
  {stage:'retrieve',role:'server',detail:'Retrieved readable product-page text',url},
  {stage:'search',role:'researcher',provider:'openai',model:'gpt-6-luna',detail:'Searched for “Orbit Desk shared queue deployment”'},
  {stage:'search',role:'server',provider:'tavily',detail:'Searching Tavily for “Orbit Desk support queue customer accounts”'},
  {stage:'search',role:'server',provider:'tavily',tool:'map',status:'attempted',url,detail:'Finding documentation, licensing and support pages with Tavily Map'},
  {stage:'assess',role:'assessor',model:'gpt-6-luna',detail:'Evaluating the retrieved passages'},
].map((event,i) => ({...event,at:new Date(1_800_000_000_000 + 7_000*i).toISOString()}))

test('a saved briefing shows the recorded searches, numbered sources, and scoped copy and print actions', async ({page,request}, info) => {
  const response = await request.post('/api/investigate',{data:{subject:'Orbit Desk',model:'gpt-6-luna'}})
  expect(response.ok()).toBe(true)
  const report = await response.json()
  report.activity = events
  const context = {sourceId:'CONTEXT',url:'https://docs.example/queue',title:'Team queue release notes',
    kind:'Publisher documentation',quote:'Orbit Desk added a team queue to its latest release.',status:'documented'}
  report.dossier = {...report.dossier,observations:[...(report.dossier?.observations || []),context]}
  await page.addInitScript(report => {
    sessionStorage.setItem('saaslens.history.v1',JSON.stringify([{id:'orbit',savedAt:Date.now(),report}]))
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text => {window.copiedBriefing = text}}})
    window.print = () => {window.printedTitle = document.querySelector('.brief-print h2')?.textContent}
  },report)
  await page.setViewportSize({width:1280,height:820})
  await page.goto('/')
  const main = page.locator('.brief-main')
  const stages = page.getByRole('region',{name:'Research stages'})
  const sources = page.getByRole('region',{name:'Briefing sources'})
  await expect(stages.getByRole('heading',{name:'Done'})).toBeVisible()
  await expect(stages.getByText('28s')).toBeVisible()
  await expect(stages.getByText('Orbit Desk shared queue deployment')).toBeVisible()
  await expect(stages.getByText('Tavily',{exact:true})).toBeVisible()
  await stages.getByText('1 more search').click()
  await expect(stages.getByText('Tavily Map',{exact:true})).toBeVisible()
  await expect(sources.getByText('Context only',{exact:true}).last()).toBeVisible()
  const source = report.sources.find(item => report.verdictEvidenceIds.includes(item.id))
  expect(source).toBeTruthy()
  const citation = main.locator('.verdict-sources a').and(page.locator('[href="'+source.url+'"]')).first()
  const ordinal = report.sources.findIndex(item => item.id === source.id) + 1
  await expect(citation).toHaveText('[' + ordinal + ']')
  await expect(sources.getByRole('listitem').nth(ordinal-1).getByRole('link')).toHaveAttribute('href',source.url)
  const decisive = report.checks.find(check => check.explanation && report.interpretation.includes(check.explanation))
  expect(decisive).toBeTruthy()
  await expect(main.locator('.highlights .finding-reason').filter({hasText:decisive.explanation})).toHaveCount(0)
  await stages.getByText('1 more search').click()
  await page.locator('.report').evaluate(el => el.scrollIntoView({block:'start'}))
  await page.screenshot({path:info.outputPath('desktop.png')})
  await main.getByRole('button',{name:'Copy briefing'}).click()
  expect(await page.evaluate(() => window.copiedBriefing)).toContain('[' + ordinal + '] ' + source.title + ' ' + source.url)
  await main.getByRole('button',{name:'Print or save briefing as PDF'}).click()
  expect(await page.evaluate(() => window.printedTitle)).toBe(report.productName)
  await page.emulateMedia({media:'print'})
  await expect(page.getByRole('form',{name:'Product investigation',includeHidden:true})).toBeHidden()
  await expect(sources).toBeVisible()
  await expect(stages).toBeHidden()
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.brief-print')).toHaveCount(0)
  await page.emulateMedia({media:'screen'})
  await page.setViewportSize({width:390,height:844})
  await page.reload()
  await page.locator('.report').evaluate(el => el.scrollIntoView({block:'start'}))
  await page.screenshot({path:info.outputPath('mobile.png')})
  const mainBox = await main.boundingBox()
  const stagesBox = await stages.boundingBox()
  expect(stagesBox.y).toBeGreaterThan(mainBox.y + mainBox.height - 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('while an investigation is waiting, the briefing shows its active stage and leaves sources empty', async ({page},info) => {
  await page.setViewportSize({width:1280,height:820})
  await page.goto('/')
  await page.getByLabel('Product, company, or URL').fill('Orbit Desk')
  let release
  const held = new Promise(resolve => {release = resolve})
  await page.route('**/api/investigate',async route => {await held; await route.continue()})
  await page.getByRole('button',{name:'Investigate',exact:true}).click()
  try {
    await expect(page.getByRole('heading',{name:'Plan · In progress'})).toBeVisible()
    await expect(page.getByRole('heading',{name:'Search · Pending'})).toBeVisible()
    await expect(page.getByRole('region',{name:'Pages read so far'}).getByRole('link')).toHaveCount(0)
    await page.locator('.brief-pending').evaluate(el => el.scrollIntoView({block:'start'}))
    await page.locator('.brief-pending').screenshot({path:info.outputPath('loading.png')})
  } finally { release() }
  await expect(page.locator('.report .badge')).toHaveText('Green · Core promise supported')
})
