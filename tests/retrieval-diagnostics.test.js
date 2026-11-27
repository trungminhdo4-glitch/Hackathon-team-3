import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAttempts, retrievalFailure } from '../shared/retrieval.js';
import { datasetRow, markdownReport } from '../src/datasetReport.js';

test('public failure categories omit raw transport details and preserve unknown causes on earlier reports', () => {
  assert.deepEqual(retrievalFailure({name:'TimeoutError',message:'private socket'}), {code:'timeout'});
  assert.deepEqual(retrievalFailure({code:'PAGE_CHALLENGE'}), {code:'challenge'});
  assert.deepEqual(retrievalFailure(new Error('sensitive exception payload')), {code:'unavailable'});
  const [older] = pageAttempts({url:'https://review.example/',status:'unavailable',origin:'web_search'});
  assert.match(older.lane,/lane unrecorded/);
  assert.match(older.reason,/specific cause was not recorded/);
});

test('CSV and Markdown identify a blocked URL and an independent search redirected to its publisher', () => {
  const url = 'https://reviews.example/product';
  const report = {rubricVersion:2,productName:'Example',inputUrl:url,verdict:'yellow',checks:[],sources:[],limitations:[],
    dossier:{observations:[],coverage:[{url,title:'Review',status:'unavailable',
      attempts:[{lane:'independent',outcome:'unavailable',requestedUrl:url,failure:{code:'http',httpStatus:404}}]},
      {url:'https://product.example/',title:'Pricing',status:'excluded_publisher',attempts:[
        {lane:'independent',outcome:'excluded_publisher',requestedUrl:'https://directory.example/listing'}]}]}};
  const row = datasetRow(report);
  for (const text of [row.reasoning, markdownReport(row,report)]) {
    assert.match(text,/Independent search/);
    assert.match(text,/HTTP 404/);
    assert.match(text,/current location/);
    assert.match(text,/directory.example\/listing/);
    assert.match(text,/resolved to the product publisher/);
  }
});
