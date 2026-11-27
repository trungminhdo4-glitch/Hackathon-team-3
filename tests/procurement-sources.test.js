import test from 'node:test';
import assert from 'node:assert/strict';
import { hasOversightLead, isOversightPublisher, likelyDownload, needsDisposition, prioritizeRecords } from '../server/procurementSources.js';

test('source selection reserves room for a final order and lifecycle record in a long result list', () => {
  const urls = ['https://research.example/deployment', 'https://news.example/opinion',
    'https://issuer.example/complaint.pdf', 'https://issuer.example/final-order', 'https://docs.example/lifecycle'];
  assert.deepEqual(prioritizeRecords(urls, 'https://app.example', 'independent'), [urls[0],urls[3],urls[4],urls[1],urls[2]]);
});

test('an open proceeding prompts a targeted search until the disposition is located', () => {
  const proposed = {title:'Consultation', text:'The proposed order addresses an advertised product claim.'};
  const decision = {url:'https://www.ftc.gov/enforcement/decision',title:'Decision', text:'The commission issued its final order on Friday.'};
  assert.ok(needsDisposition([proposed]));
  assert.equal(needsDisposition([proposed, decision]), false);
  assert.equal(needsDisposition([{title:'Guide',text:'Sort the items in the requested order.'}]), false);
});

test('recognizes exact oversight publishers and ranks readable decisions ahead of commentary', () => {
  const board = 'https://www.edpb.europa.eu/news/national-news/decision';
  const dutch = 'https://autoriteitpersoonsgegevens.nl/en/current/decision';
  assert.ok(isOversightPublisher(board));
  assert.ok(isOversightPublisher(dutch));
  for (const fake of ['https://www.ftc.gov.other.example/decision', 'https://other.example/cnil.fr',
    'https://ftc.gov@news.example/', 'https://uploads.ftc.gov/', 'http://www.ftc.gov/', undefined]) {
    assert.equal(isOversightPublisher(fake), false);
  }
  const urls = ['https://customer.example/deployment', 'https://press.example/opinion',
    'https://www.cnil.fr/en/deep-analysis.pdf', board, dutch];
  assert.deepEqual(prioritizeRecords(urls,'https://vendor.example','independent'),[urls[0], board, dutch, urls[1], urls[2]]);
});

test('use of sensitive data merits a scoped disposition search even when adoption was documented', () => {
  const inputUrl = 'https://atlasid.example/';
  const pages = [{url:inputUrl, title:'AtlasID', text:'AtlasID provides biometric identification to public agencies.'},
    {url:'https://press.example/review', title:'Customer deployment',text:'The agency deployed this platform. A regulator fined AtlasID for unlawful processing.'}];
  const decision = {url:'https://www.edpb.europa.eu/news/national-news/case',title:'National authority decision on AtlasID',
    text:'The authority imposed a fine on AtlasID for unlawfully processing residents’ biometric data.'};
  assert.ok(needsDisposition(pages, inputUrl, 'AtlasID'));
  assert.ok(needsDisposition([...pages,{...decision,title:'Other case',text:decision.text.replace('AtlasID','AnotherFirm')}],inputUrl,'AtlasID'));
  assert.ok(needsDisposition([...pages,{...decision,text:'The proposed decision includes a fine of EUR 2 million for AtlasID.'}],inputUrl,'AtlasID'));
  assert.equal(needsDisposition([...pages,decision],inputUrl,'AtlasID'),false);
  assert.equal(hasOversightLead({title:'Dashboard',text:'Read our privacy policy and the GDPR FAQ.'}),false);
});

test('authority case links may identify a regulator lead even when the document format cannot be read', () => {
  const inputUrl = 'https://atlasid.example/';
  const queryFile = 'https://ico.org.uk/notices/download?file=AtlasID-penalty%2Epdf';
  const applicationPdf = 'https://ico.org.uk/AtlasID-decision?format=application%2Fpdf';
  const publicNotice = 'https://ico.org.uk/action-weve-taken/enforcement/atlasid-decision';
  for (const address of [queryFile,applicationPdf]) assert.ok(likelyDownload(address));
  assert.deepEqual(prioritizeRecords([queryFile, applicationPdf, publicNotice],inputUrl,'independent'),[publicNotice,queryFile,applicationPdf]);
  assert.ok(needsDisposition([],inputUrl,undefined,{candidateUrls:[queryFile],requireCaseLead:true}));
  assert.equal(needsDisposition([],inputUrl,undefined,{candidateUrls:[queryFile.replace('AtlasID','Unrelated')],requireCaseLead:true}),false);
  const sectorOnly = [{title:'AtlasID',text:'AtlasID provides biometric identification.'}];
  assert.equal(needsDisposition(sectorOnly,inputUrl,undefined,{requireCaseLead:true}),false);
});
