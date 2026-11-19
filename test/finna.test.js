// Offline tests: the network is replaced by a fake fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FinnaError, buildSearchParams, buildingTree, fetchAvailability,
  formatAvailability, formatRecord, formatSearch, getRecords, libraryOfId,
  localIdsOf, matchLocations, normaliseLanguage, normaliseLocation,
  parseItemStatus, recordUrl, search,
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

test('buildSearchParams: locations narrow the search, filters are added', () => {
  const p = buildSearchParams({
    query: 'x', libraries: ['helmet', 'helka'], locations: ['1/Helmet/v'],
    format: 'any', language: 'SWE', yearFrom: 2010, sort: 'newest',
    searchIn: 'author', facets: ['language'],
  });
  assert.deepEqual(p.getAll('filter[]'), [
    '~building:"1/Helmet/v/"', 'language:"swe"',
    'search_daterange_mv:"[2010 TO *]"',
  ]);
  assert.equal(p.get('sort'), 'main_date_str desc');
  assert.equal(p.get('type'), 'Author');
  assert.deepEqual(p.getAll('facet[]'), ['language']);
});

test('buildSearchParams rejects bad input', () => {
  assert.throws(() => buildSearchParams({ language: 'fin"' }), FinnaError);
  assert.throws(() => buildSearchParams({ yearFrom: 2020, yearTo: 2010 }), FinnaError);
  // A location outside the chosen library systems is a mistake, not a hint.
  assert.throws(
    () => buildSearchParams({ libraries: ['helka'], locations: ['1/Helmet/v/'] }),
    /belongs to Helmet/,
  );
});

test('normaliseLanguage accepts common two-letter and older codes', () => {
  assert.equal(normaliseLanguage('fi'), 'fin');
  assert.equal(normaliseLanguage('SV'), 'swe');
  assert.equal(normaliseLanguage('ger'), 'deu');
  assert.equal(normaliseLanguage('est'), 'est');
  assert.throws(() => normaliseLanguage('xx'), /three-letter/);
});

const TREE = [
  {
    code: '1/Helmet/e/', name: 'Espoo', children: [
      { code: '2/Helmet/e/e10/', name: 'Tapiola' },
      { code: '2/Helmet/e/e10l/', name: 'Tapiola lapset' },
    ],
  },
  {
    code: '1/Helmet/h/', name: 'Helsinki', children: [
      { code: '2/Helmet/h/h00/', name: 'Oodi' },
      { code: '2/Helmet/h/h00l/', name: 'Oodi lapset' },
      { code: '2/Helmet/h/h01/', name: 'Pasila' },
      { code: '2/Helmet/h/h82/', name: 'Etelä-Haaga' },
      { code: '2/Helmet/h/hva/', name: 'Kirjastoauto Helsinki' },
    ],
  },
  { code: '1/3AMK/HHPAS/', name: 'Haaga-Helia Pasila', children: [] },
  { code: '1/3AMK/HHHAA/', name: 'Haaga-Helia Haaga', children: [] },
];

test('matchLocations: a branch name covers its sections', () => {
  assert.deepEqual(matchLocations('oodi', TREE).map((h) => h.code),
    ['2/Helmet/h/h00/', '2/Helmet/h/h00l/']);
});

test('matchLocations: an exact city name does not pull in its branches', () => {
  assert.deepEqual(matchLocations('Helsinki', TREE).map((h) => h.code), ['1/Helmet/h/']);
});

test('matchLocations: whole words only, across systems', () => {
  assert.deepEqual(matchLocations('Pasila', TREE).map((h) => h.name),
    ['Pasila', 'Haaga-Helia Pasila']);
  // "Haaga" is a word of one campus name, not of "Haaga-Helia" or "Etelä-Haaga".
  assert.deepEqual(matchLocations('Haaga', TREE).map((h) => h.name), ['Haaga-Helia Haaga']);
  assert.deepEqual(matchLocations('Tapio', TREE), []);
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

test('search names its scope, counts and refinements', async () => {
  const fetchImpl = fakeFetch({
    resultCount: 40, status: 'OK',
    records: [{ id: 'helmet.5', title: 'Design', dedupIds: ['helmet.5'] }],
    facets: {
      language: [{ value: 'fin', count: 30 }, { value: 'eng', count: 10 }],
      format: [{ value: '0/Book/', count: 35 }, { value: '0/Video/', count: 5 },
        { value: '0/Other/', count: 1 }],
    },
  }, {});
  const opts = { query: 'design', locations: ['2/Helmet/h/h00/'], format: 'any' };
  const out = formatSearch(await search(opts, fetchImpl), { ...opts, availability: true });
  assert.match(out, /40 titles for "design" in 2\/Helmet\/h\/h00\/ \(format: any\)/);
  assert.match(out, /Narrow with language: fin 30, eng 10 · format: book 35, video 5\./);
  assert.match(out, /check_availability/);
  assert.doesNotMatch(formatSearch(await search(opts, fetchImpl), opts), /check_availability/);
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
  await assert.rejects(getRecords(['helmet.404'], fetchImpl), /No record with ID "helmet\.404"/);
  calls.length = 0;
  const { records, siblings } = await getRecords(['helka.9', 'helmet.404'], fetchImpl);
  assert.equal(records.has('helmet.404'), false);
  assert.deepEqual(records.get('helka.9').dedupIds, ['3amk.2', 'helka.9', 'aalto.3']);
  assert.deepEqual([...siblings.keys()], ['3amk.2']);
  // The group lookup asks only about the record that exists.
  assert.deepEqual(calls[1].searchParams.getAll('filter[]'),
    ['~local_ids_str_mv:"helka.9"']);
});

// Trimmed from a real answer of www.finna.fi/AJAX/JSON?method=getItemStatuses.
const row = (state, name, shelf) => `
    <div class="odd clearfix"><div class="no-branches">
      <div class="groupLocation status-${state}">
        <span class="icon icon--font fi" role="img" aria-hidden="true"></span>
        <span class="location-name"><span class="branch">${name}</span></span>
      </div>
      <div class="groupCallnumber">${shelf}</div>
    </div></div>`;
const shelfMark = (mark) => `
        <!-- START of: finna - Helpers/holding-callnumber.phtml -->
        <div class="location-link-text"><span class="callnumber-text">
          <span>Shelf: </span>${mark}    </span></div>`;
const STATUS = {
  id: 'helmet.1',
  availability: 'available',
  full_status: `<!-- START of: finna - ajax/status-full.phtml -->
  <div class="header holdings available clearfix"><div>
    <span class="available-total status-available">
      <span class="icon" role="img"></span> <span>1&nbsp;available</span></span>
    <span class="info"><span class="reservations">Reservations:&nbsp;2</span>
      <span class="total">Items:&nbsp;3</span></span>
  </div></div>
  <div class="holdings truncate-field" data-rows="5">${
    row('available', 'Tapiola aik', shelfMark('75.13 TUF'))}${
    row('unavailable', 'Sello las', shelfMark('84.2 JAN &amp; co'))}${
    row('unavailable', 'none', shelfMark('Tilattu 30.8.2025'))}
  </div>
  <div class="actions clearfix"><div class="title-hold">
    <a href="/Record/helmet.1?login=true">Login to place a hold</a></div></div>
  <script nonce="x">finna.layout.initTruncate($('.holding-details'));</script>`,
};

test('parseItemStatus reads counts, branches and shelf marks', () => {
  assert.deepEqual(parseItemStatus(STATUS), {
    id: 'helmet.1', known: true, available: 1, total: 3, reservations: 2,
    locations: [
      { name: 'Tapiola aik', available: true, shelf: '75.13 TUF' },
      { name: 'Sello las', available: false, shelf: '84.2 JAN & co' },
      { name: '', available: false, shelf: 'Tilattu 30.8.2025' },
    ],
  });
});

test('parseItemStatus: a record without holdings is unknown', () => {
  const s = parseItemStatus({
    id: 'helmet.404', availability: 'false', missing_data: true,
    full_status: 'No Holdings Available',
  });
  assert.equal(s.known, false);
  assert.deepEqual(s.locations, []);
});

test('fetchAvailability asks the website once and labels the records', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u);
    const body = u.host === 'www.finna.fi'
      ? { data: { statuses: [STATUS] } }
      : {
        status: 'OK',
        records: [{
          id: 'helmet.1', title: 'Visual explanations', year: '1998',
          buildings: [b('0/Helmet/', 'Helmet'), b('1/Helmet/e/', 'Espoo'),
            b('2/Helmet/e/e10/', 'Tapiola'), b('2/Helmet/e/e01l/', 'Sello lapset')],
        }],
      };
    return { ok: true, status: 200, json: async () => body };
  };
  const entries = await fetchAvailability(['helmet.1', 'helmet.404'], fetchImpl);
  const web = calls.filter((u) => u.host === 'www.finna.fi');
  assert.equal(web.length, 1);
  assert.deepEqual(web[0].searchParams.getAll('id[]'), ['helmet.1', 'helmet.404']);

  const out = formatAvailability(entries, new Date('2026-11-19T17:16:00Z'));
  assert.match(out, /Visual explanations \(1998\) \[helmet\.1\] — Helmet\n1 of 3 copies available, 2 reservations\./);
  assert.match(out, /Available at: Tapiola aik \(shelf 75\.13 TUF\)/);
  assert.match(out, /Not available now at: Sello las; Tilattu 30\.8\.2025/);
  assert.match(out, /\[helmet\.404\] — Helmet\nNo record with this ID\./);
  assert.match(out, /read 19 Nov 2026, 19:16 Helsinki time/);
  assert.doesNotMatch(out, /branch not named/);
});

test('formatAvailability marks rows that do not say which branch', () => {
  const out = formatAvailability([{
    id: 'helka.9', known: true, available: 2, total: 2, reservations: null,
    locations: [
      { name: 'Kaisa House, 28 days', available: true, shelf: 'Kielet Y Tufte' },
      { name: '28 days', available: true, shelf: '004.12 Tufte' },
    ],
    record: {
      id: 'helka.9', title: 'Visual explanations', year: '1997',
      buildings: [b('0/HELKA/', 'Helka Libraries'), b('1/HELKA/KAISA/', 'Kaisa House'),
        b('1/HELKA/KUMPULA/', 'Kumpula')],
    },
  }]);
  assert.match(out, /Kaisa House, 28 days \(shelf Kielet Y Tufte\); 28 days \[branch not named\] \(shelf 004\.12 Tufte\)/);
  assert.match(out, /The catalogue lists this record at: Kaisa House, Kumpula\./);
});

test('fetchAvailability reports a website that answers something else', async () => {
  const fetchImpl = async (url) => ({
    ok: new URL(url).host !== 'www.finna.fi', status: 403,
    json: async () => ({ status: 'OK', records: [] }),
  });
  await assert.rejects(fetchAvailability(['helmet.1'], fetchImpl), /did not return shelf status/);
});
