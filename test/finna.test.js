// Offline tests: the network is replaced by a fake fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FinnaError, buildSearchParams, buildingTree, formatRecord, formatSearch,
  getRecords, libraryOfId, localIdsOf, normaliseLocation, recordUrl, search,
} from '../src/finna.js';

const b = (value, translated) => ({ value, translated });

test('libraryOfId recognises only the three systems', () => {
  assert.equal(libraryOfId('helmet.2573256'), 'helmet');
  assert.equal(libraryOfId('helka.994895613506253'), 'helka');
  assert.equal(libraryOfId('3amk.238373'), '3amk');
  assert.equal(libraryOfId('eepos.1746330'), null);
});

test('recordUrl picks the right website', () => {
  assert.equal(recordUrl('helmet.1'), 'https://helmet.finna.fi/Record/helmet.1');
  assert.equal(recordUrl('3amk.1'), 'https://www.finna.fi/Record/3amk.1');
});

test('normaliseLocation accepts valid codes and adds the slash', () => {
  assert.equal(normaliseLocation('1/Helmet/h'), '1/Helmet/h/');
  assert.equal(normaliseLocation('2/Helmet/h/h00l/'), '2/Helmet/h/h00l/');
  assert.equal(normaliseLocation('1/HELKA/KAISA/'), '1/HELKA/KAISA/');
});

test('normaliseLocation rejects other libraries, wrong depth and quotes', () => {
  for (const bad of ['1/Eepos/1/', '0/Helmet/', '1/Helmet/h/h00l/', '2/Helmet/h/',
    '1/Helmet/h"/', 'Oodi']) {
    assert.throws(() => normaliseLocation(bad), FinnaError, bad);
  }
});

test('buildSearchParams: defaults search books in all three systems', () => {
  const p = buildSearchParams({ query: 'muumipappa' });
  assert.equal(p.get('lookfor'), 'muumipappa');
  assert.equal(p.get('type'), 'AllFields');
  assert.deepEqual(p.getAll('filter[]'), [
    '~building:"0/Helmet/"', '~building:"0/HELKA/"', '~building:"0/3AMK/"',
    'format:"0/Book/"',
  ]);
  assert.ok(p.getAll('field[]').includes('dedupIds'));
});

test('buildSearchParams: locations replace libraries, filters are added', () => {
  const p = buildSearchParams({
    query: 'x', libraries: ['helka'], locations: ['1/Helmet/v'], format: 'any',
    language: 'SWE', yearFrom: 2010, sort: 'newest', searchIn: 'author',
  });
  assert.deepEqual(p.getAll('filter[]'), [
    '~building:"1/Helmet/v/"', 'language:"swe"',
    'search_daterange_mv:"[2010 TO *]"',
  ]);
  assert.equal(p.get('sort'), 'main_date_str desc');
  assert.equal(p.get('type'), 'Author');
});

test('buildSearchParams rejects bad input', () => {
  assert.throws(() => buildSearchParams({ language: 'fin"' }), FinnaError);
  assert.throws(() => buildSearchParams({ yearFrom: 2020, yearTo: 2010 }), FinnaError);
});

test('localIdsOf keeps the Helsinki-area copies only', () => {
  assert.deepEqual(
    localIdsOf({ id: 'eepos.1', dedupIds: ['eepos.1', 'helka.9', 'aalto.3', '3amk.2'] }),
    ['helka.9', '3amk.2'],
  );
  assert.deepEqual(localIdsOf({ id: 'helmet.5' }), ['helmet.5']);
});

test('buildingTree nests branches under cities', () => {
  const tree = buildingTree([
    b('0/Helmet/', 'Helmet-kirjastot'), b('1/Helmet/h/', 'Helsinki'),
    b('1/Helmet/e/', 'Espoo'), b('2/Helmet/h/h00l/', 'Oodi lapset'),
    b('2/Helmet/e/e01l/', 'Sello lapset'),
  ]);
  assert.deepEqual(tree.map((n) => n.name), ['Espoo', 'Helsinki']);
  assert.deepEqual(tree[1].children, [{ code: '2/Helmet/h/h00l/', name: 'Oodi lapset' }]);
});

/** Fake fetch that answers /search and /record from canned data. */
function fakeFetch(searchBody, recordsById, calls = []) {
  return async (url) => {
    const u = new URL(url);
    calls.push(u);
    const body = u.pathname.endsWith('/search')
      ? searchBody
      : (() => {
        const records = u.searchParams.getAll('id[]')
          .map((id) => recordsById[id]).filter(Boolean);
        return { resultCount: records.length, records, status: 'OK' };
      })();
    return { ok: true, status: 200, json: async () => body };
  };
}

test('search replaces an outside representative with the local copies', async () => {
  const calls = [];
  const helka = {
    id: 'helka.9', title: 'Muumipappa ja meri', primaryAuthors: ['Jansson, Tove'],
    year: '1965', languages: ['fin'],
    formats: [b('0/Book/', 'Book material'), b('1/Book/Book/', 'Book')],
    buildings: [b('0/HELKA/', 'Helka Libraries'), b('1/HELKA/KAISA/', 'Kaisa House')],
  };
  const helmet = {
    id: 'helmet.5', title: 'Yllätys kasvimaalla', year: '2012',
    buildings: [b('0/Helmet/', 'Helmet-kirjastot'), b('1/Helmet/h/', 'Helsinki')],
    dedupIds: ['helmet.5'],
  };
  const fetchImpl = fakeFetch({
    resultCount: 2, status: 'OK',
    records: [
      { id: 'eepos.1', title: 'Muumipappa ja meri', dedupIds: ['eepos.1', 'helka.9'] },
      helmet,
    ],
  }, { 'helka.9': helka }, calls);

  const result = await search({ query: 'muumipappa' }, fetchImpl);
  assert.equal(result.groups[0].holdings[0].id, 'helka.9');
  assert.equal(result.groups[1].holdings[0].id, 'helmet.5');
  // Only the copy that was not already in the search response is fetched.
  assert.deepEqual(calls[1].searchParams.getAll('id[]'), ['helka.9']);
  assert.equal(calls.length, 2);

  const out = formatSearch(result, { query: 'muumipappa' });
  assert.match(out, /1\. Muumipappa ja meri — Jansson, Tove \(1965\) · Book · fin/);
  assert.match(out, /Helka \[helka\.9\]: Kaisa House — https:\/\/helka\.finna\.fi\/Record\/helka\.9/);
  assert.match(out, /Helmet \[helmet\.5\]: Helsinki/);
  assert.doesNotMatch(out, /eepos/);
});

test('API errors become FinnaError with the reason', async () => {
  const fetchImpl = async () => ({
    ok: false, status: 400,
    json: async () => ({ status: 'ERROR', statusMessage: 'Invalid search' }),
  });
  await assert.rejects(search({ query: 'x' }, fetchImpl), /Invalid search/);
});

test('formatSearch explains an empty result', () => {
  const out = formatSearch({ resultCount: 0, groups: [] }, { query: 'zzz' });
  assert.match(out, /No results for "zzz" in Helmet, Helka, 3AMK/);
});

test('formatRecord lists branches and sibling systems', () => {
  const out = formatRecord({
    id: 'helka.9', title: 'Envisioning information', primaryAuthors: ['Tufte, Edward R.'],
    year: '1991', subjects: [['Visual communication.']],
    buildings: [b('0/HELKA/', 'Helka Libraries'), b('1/HELKA/KAISA/', 'Kaisa House')],
    dedupIds: ['helka.9', '3amk.2', 'aalto.3'],
  }, new Map([['3amk.2', {
    id: '3amk.2', buildings: [b('1/3AMK/HHPAS/', 'Haaga-Helia Pasila')],
  }]]));
  assert.match(out, /Envisioning information \[helka\.9\]/);
  assert.match(out, /- Kaisa House \[1\/HELKA\/KAISA\/\]/);
  assert.match(out, /- 3AMK \[3amk\.2\]: Haaga-Helia Pasila/);
  assert.match(out, /Also in 1 other Finnish library catalogue outside these three/);
});

test('getRecords finds the same title in the other systems', async () => {
  const calls = [];
  const fetchImpl = fakeFetch(
    {
      resultCount: 1, status: 'OK',
      records: [{ id: '3amk.2', dedupIds: ['3amk.2', 'helka.9', 'aalto.3'] }],
    },
    {
      'helka.9': { id: 'helka.9', title: 'Envisioning information' },
      '3amk.2': { id: '3amk.2', buildings: [b('1/3AMK/HHPAS/', 'Haaga-Helia Pasila')] },
    },
    calls,
  );
  const { records, siblings } = await getRecords(['helka.9', 'helmet.404'], fetchImpl);
  assert.equal(records.has('helmet.404'), false);
  assert.deepEqual(records.get('helka.9').dedupIds, ['3amk.2', 'helka.9', 'aalto.3']);
  assert.deepEqual([...siblings.keys()], ['3amk.2']);
  // The group lookup asks only about the record that exists.
  assert.deepEqual(calls[1].searchParams.getAll('filter[]'),
    ['~local_ids_str_mv:"helka.9"']);
});
