import { test, expect } from '@playwright/test'

test('an unresolved review shows the cited source, the classification obstacle and a concrete request', async ({page}) => {
  const url = 'https://blue.example/product'
  const quote = 'A team can publish calendar slots from a shared workspace.'
  const report = {productName:'Blue Calendar', rubricVersion:2, subject:url, inputUrl:url, vendor:null,
    verdict:null, interpretation:'Team scheduling remains unconfirmed.', checks:[{id:'capability', label:'Core capability',
      status:'unverified', evidence:[], explanation:'No team deployment was found.'}], sources:[], limitations:[],
    dossier:{observations:[{sourceId:'S1',url,title:'Blue Calendar workspace',kind:'Product page', status:'documented',
      criterion:'capability',quote,finding:'The publisher describes team scheduling.',
      reason:'This page establishes the advertised feature.'}],
      coverage:[{url,title:'Blue Calendar workspace',origin:'submitted',status:'documented',reason:'Product claim retained.'}]},
    review:{id:'sample',mode:'local',prompt:'Which deployment should we verify?',expiresAt:new Date(Date.now()+600_000).toISOString(),
      brief:{known:'The homepage advertises shared calendar slots.',knownUrl:url,knownTitle:'Calendar page',
        obstacle:'The only independent source described the personal edition.',green:'Verify an actual team deployment.',
        yellow:'A scheduling limitation would affect teams.', red:'An authoritative test would need to contradict the team claim.',
        request:'Which deployment should we verify?'}}}
  await page.addInitScript(report => sessionStorage.setItem('saaslens.history.v1',JSON.stringify([
    {id:'review',savedAt:Date.now(),report}
  ])),report)
  await page.goto('/')
  const review = page.getByRole('region',{name:'Your input can guide the research'})
  await expect(review.getByText(report.review.brief.obstacle)).toBeVisible()
  await expect(review.getByRole('link',{name:'Calendar page'})).toHaveAttribute('href',url)
  for (const label of ['What would support Green','What warrants Yellow','What would support Red']) {
    await expect(review.getByText(label)).toBeVisible()
  }
  await expect(review.getByText(report.review.prompt,{exact:true})).toHaveCount(1)
  const dossier = page.getByRole('region',{name:'What the sources say'})
  await expect(dossier.getByText(quote,{exact:true})).toBeVisible()
  await expect(dossier.getByRole('link',{name:'blue.example'})).toHaveAttribute('href',url)
  await dossier.getByText('Pages checked (1)').click()
  await expect(dossier.getByText('Product claim retained.')).toBeVisible()
  await page.getByText('Related source passages').click()
  await expect(page.locator('.criterion-context blockquote')).toHaveText(quote)
})
