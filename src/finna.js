// Finna API client and result formatting for the three Helsinki-area library
// systems. No MCP code in here, so it can be tested and reused on its own.

export const API_BASE = 'https://api.finna.fi/v1';
const USER_AGENT = 'finna-helsinki-libraries-mcp/0.1';
const TIMEOUT_MS = 20_000;
// /record accepts many id[] values per call; 60 was tested, 50 keeps URLs short.
const RECORD_BATCH = 50;

export const LIBRARIES = {
  helmet: {
    name: 'Helmet',
    about: 'public libraries of Helsinki, Espoo, Vantaa and Kauniainen',
    code: 'Helmet',
    recordUrl: (id) => `https://helmet.finna.fi/Record/${encodeURIComponent(id)}`,
  },
  helka: {
    name: 'Helka',
    about: 'University of Helsinki libraries',
    code: 'HELKA',
    recordUrl: (id) => `https://helka.finna.fi/Record/${encodeURIComponent(id)}`,
  },
  '3amk': {
    name: '3AMK',
    about: 'Haaga-Helia, Laurea and Metropolia campus libraries',
    code: '3AMK',
    // 3amk.finna.fi answered 403 when tested, the national view works.
    recordUrl: (id) => `https://www.finna.fi/Record/${encodeURIComponent(id)}`,
  },
};
export const LIBRARY_KEYS = Object.keys(LIBRARIES);

export const FORMATS = {
  any: null,
  book: '0/Book/',
  printed_book: '1/Book/Book/',
  ebook: '1/Book/eBook/',
  audiobook: '1/Book/AudioBook/',
  sound: '0/Sound/',
  video: '0/Video/',
  musical_score: '0/MusicalScore/',
  journal: '0/Journal/',
  thesis: '0/Thesis/',
  game: '0/Game/',
  map: '0/Map/',
};

export const SEARCH_TYPES = {
  all: 'AllFields',
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
};

export const SORTS = {
  relevance: 'relevance',
  newest: 'main_date_str desc',
  oldest: 'main_date_str asc',
  title: 'title',
  author: 'author',
};

const SEARCH_FIELDS = [
  'id', 'title', 'primaryAuthors', 'nonPresenterAuthors', 'year', 'formats',
  'languages', 'buildings', 'dedupIds',
];
const HOLDING_FIELDS = SEARCH_FIELDS.filter((f) => f !== 'dedupIds');
const DETAIL_FIELDS = [
  'id', 'title', 'primaryAuthors', 'secondaryAuthors', 'corporateAuthors',
  'year', 'publishers', 'placesOfPublication', 'edition', 'isbns', 'languages',
  'originalLanguages', 'formats', 'physicalDescriptions', 'series', 'subjects',
  'genres', 'summary', 'callNumbers', 'buildings', 'onlineUrls',
];

export class FinnaError extends Error {}

/** Which of the three systems a record ID belongs to, or null. */
export function libraryOfId(id) {
  const prefix = String(id).split('.')[0].toLowerCase();
  return LIBRARY_KEYS.includes(prefix) ? prefix : null;
}

export function recordUrl(id) {
  const lib = libraryOfId(id);
  return lib
    ? LIBRARIES[lib].recordUrl(id)
    : `https://www.finna.fi/Record/${encodeURIComponent(id)}`;
}

/**
 * Checks a building code such as "1/Helmet/h/" or "2/Helmet/h/h00l/" and
 * returns it with a trailing slash. Only the three systems are accepted.
 */
export function normaliseLocation(raw) {
  let code = String(raw).trim();
  if (!code.endsWith('/')) code += '/';
  const m = /^([12])\/([^/"\\]+)\/(?:[^/"\\]+\/)+$/.exec(code);
  const known = LIBRARY_KEYS.map((k) => LIBRARIES[k].code);
  if (!m || !known.includes(m[2])) {
    throw new FinnaError(
      `"${raw}" is not a location code of Helmet, Helka or 3AMK. ` +
        'Codes look like "1/Helmet/h/" (a city or campus) or "2/Helmet/h/h00l/" ' +
        '(a branch section); list_locations returns the valid ones.',
    );
  }
  if (code.split('/').length - 2 !== Number(m[1]) + 1) {
    throw new FinnaError(
      `"${raw}" has the wrong depth: a code starting with ${m[1]}/ has ` +
        `${Number(m[1]) + 1} parts after it.`,
    );
  }
  return code;
}

/** Builds the query string for /search from the tool's options. */
export function buildSearchParams(opts = {}) {
  const {
    query = '', searchIn = 'all', libraries = LIBRARY_KEYS, locations = [],
    format = 'book', language, yearFrom, yearTo, sort = 'relevance',
    page = 1, limit = 10, fields = SEARCH_FIELDS,
  } = opts;

  const p = new URLSearchParams();
  p.set('lookfor', query);
  p.set('type', SEARCH_TYPES[searchIn]);
  p.set('sort', SORTS[sort]);
  p.set('page', String(page));
  p.set('limit', String(limit));
  p.set('lng', 'en-gb');

  // "~" makes the filters on one field alternatives (OR) instead of AND.
  const buildings = locations.length
    ? locations.map(normaliseLocation)
    : libraries.map((k) => `0/${LIBRARIES[k].code}/`);
  if (!buildings.length) throw new FinnaError('Choose at least one library.');
  for (const b of buildings) p.append('filter[]', `~building:"${b}"`);

  if (FORMATS[format]) p.append('filter[]', `format:"${FORMATS[format]}"`);
  if (language) {
    if (!/^[a-z]{2,3}$/i.test(language)) {
      throw new FinnaError(
        `"${language}" is not a language code. Use three letters, e.g. fin, swe, eng.`,
      );
    }
    p.append('filter[]', `language:"${language.toLowerCase()}"`);
  }
  if (yearFrom != null || yearTo != null) {
    if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
      throw new FinnaError('year_from is later than year_to.');
    }
    p.append(
      'filter[]',
      `search_daterange_mv:"[${yearFrom ?? '*'} TO ${yearTo ?? '*'}]"`,
    );
  }
  for (const f of fields) p.append('field[]', f);
  return p;
}

async function getJson(path, params, fetchImpl) {
  const url = `${API_BASE}/${path}?${params}`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new FinnaError(`Could not reach api.finna.fi: ${err.message}`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new FinnaError(`api.finna.fi answered HTTP ${res.status} without JSON.`);
  }
  if (!res.ok || body.status !== 'OK') {
    throw new FinnaError(
      `api.finna.fi rejected the request (HTTP ${res.status}): ` +
        (body.statusMessage ?? 'no reason given'),
    );
  }
  return body;
}

/** Fetches records by ID in batches. Unknown IDs are silently left out by the API. */
export async function fetchRecords(ids, fields, fetchImpl = fetch) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += RECORD_BATCH) {
    const p = new URLSearchParams({ lng: 'en-gb' });
    for (const id of ids.slice(i, i + RECORD_BATCH)) p.append('id[]', id);
    for (const f of fields) p.append('field[]', f);
    const body = await getJson('record', p, fetchImpl);
    for (const r of body.records ?? []) out.set(r.id, r);
  }
  return out;
}

/** IDs of the Helmet, Helka and 3AMK copies of a search result. */
export function localIdsOf(record) {
  const all = [record.id, ...(record.dedupIds ?? [])];
  return [...new Set(all)].filter(libraryOfId);
}

/**
 * Finna merges the same title from different libraries into one search result
 * and shows whichever library ranks first, which is often one outside
 * Helsinki. This replaces every result with its Helmet, Helka and 3AMK copies.
 */
async function resolveHoldings(records, fetchImpl) {
  const known = new Map();
  for (const r of records) if (libraryOfId(r.id)) known.set(r.id, r);
  const missing = [
    ...new Set(records.flatMap(localIdsOf).filter((id) => !known.has(id))),
  ];
  const fetched = await fetchRecords(missing, HOLDING_FIELDS, fetchImpl);
  return records.map((r) => ({
    representative: r,
    holdings: localIdsOf(r)
      .map((id) => known.get(id) ?? fetched.get(id))
      .filter(Boolean)
      // Always Helmet, Helka, 3AMK, whichever one Finna happened to rank first.
      .sort((a, b) =>
        LIBRARY_KEYS.indexOf(libraryOfId(a.id)) - LIBRARY_KEYS.indexOf(libraryOfId(b.id))),
  }));
}

export async function search(opts, fetchImpl = fetch) {
  const body = await getJson('search', buildSearchParams(opts), fetchImpl);
  const groups = await resolveHoldings(body.records ?? [], fetchImpl);
  return { resultCount: body.resultCount ?? 0, groups };
}

/**
 * /record does not return dedupIds, so the other libraries' copies of a
 * record are looked up with a search on the index field that holds the IDs
 * of every record merged into a result.
 */
async function fetchDedupIds(ids, fetchImpl) {
  const p = new URLSearchParams({ lookfor: '', limit: String(ids.length) });
  for (const id of ids) {
    p.append('filter[]', `~local_ids_str_mv:"${id.replace(/["\\]/g, '')}"`);
  }
  p.append('field[]', 'id');
  p.append('field[]', 'dedupIds');
  const body = await getJson('search', p, fetchImpl);
  const out = new Map();
  for (const r of body.records ?? []) {
    const group = r.dedupIds ?? [r.id];
    for (const id of ids) if (group.includes(id)) out.set(id, group);
  }
  return out;
}

export async function getRecords(ids, fetchImpl = fetch) {
  const records = await fetchRecords(ids, DETAIL_FIELDS, fetchImpl);
  const found = ids.filter((id) => records.has(id));
  if (!found.length) return { records, siblings: new Map() };

  const groups = await fetchDedupIds(found, fetchImpl);
  for (const [id, group] of groups) records.get(id).dedupIds = group;
  // Cities and campuses of the copies in the other two systems.
  const siblingIds = [...records.values()]
    .flatMap(localIdsOf)
    .filter((id) => !records.has(id));
  const siblings = await fetchRecords(
    [...new Set(siblingIds)], HOLDING_FIELDS, fetchImpl,
  );
  return { records, siblings };
}

const locationCache = new Map();

/**
 * The API does not list cities and branches (its building facet stops at the
 * library-system level), so this collects them from a sample of records.
 */
export async function listLocations(library, fetchImpl = fetch, pages = 4) {
  if (locationCache.has(library)) return locationCache.get(library);
  const prefix = LIBRARIES[library].code;
  const seen = new Map();
  for (let page = 1; page <= pages; page++) {
    const params = buildSearchParams({
      libraries: [library], format: 'any', page, limit: 100,
      fields: ['id', 'buildings', 'dedupIds'],
    });
    const body = await getJson('search', params, fetchImpl);
    const records = body.records ?? [];
    const own = new Map(
      records.filter((r) => libraryOfId(r.id) === library).map((r) => [r.id, r]),
    );
    const missing = records
      .flatMap(localIdsOf)
      .filter((id) => libraryOfId(id) === library && !own.has(id));
    const fetched = await fetchRecords(
      [...new Set(missing)], ['id', 'buildings'], fetchImpl,
    );
    for (const r of [...own.values(), ...fetched.values()]) {
      for (const b of r.buildings ?? []) {
        if (b.value.split('/')[1] === prefix) seen.set(b.value, b.translated);
      }
    }
    if (records.length < 100) break;
  }
  const tree = buildingTree(
    [...seen].map(([value, translated]) => ({ value, translated })),
  );
  locationCache.set(library, tree);
  return tree;
}

/**
 * Turns the flat `buildings` list of a record into
 * [{ code, name, children: [{ code, name }] }] below the system level.
 */
export function buildingTree(buildings = []) {
  const level1 = new Map();
  const sorted = [...buildings].sort((a, b) => a.value.localeCompare(b.value));
  for (const b of sorted) {
    const parts = b.value.split('/');
    if (parts[0] === '1') {
      level1.set(b.value, { code: b.value, name: b.translated, children: [] });
    }
  }
  for (const b of sorted) {
    const parts = b.value.split('/');
    if (parts[0] !== '2') continue;
    const parent = `1/${parts[1]}/${parts[2]}/`;
    if (!level1.has(parent)) {
      level1.set(parent, { code: parent, name: parts[2], children: [] });
    }
    level1.get(parent).children.push({ code: b.value, name: b.translated });
  }
  return [...level1.values()].sort((a, b) => a.name.localeCompare(b.name, 'fi'));
}

// ---------------------------------------------------------------- formatting

function authorsOf(r) {
  const primary = r.primaryAuthors ?? [];
  if (primary.length) return primary;
  return (r.nonPresenterAuthors ?? []).map((a) => a.name).filter(Boolean);
}

function formatName(r) {
  const f = r.formats ?? [];
  return f.length ? f[f.length - 1].translated : '';
}

function headline(r) {
  const authors = authorsOf(r);
  const shown = authors.slice(0, 3).join('; ') + (authors.length > 3 ? ' et al.' : '');
  const bits = [formatName(r), (r.languages ?? []).join('/')].filter(Boolean);
  return (
    (r.title || '(no title)') +
    (shown ? ` — ${shown}` : '') +
    (r.year ? ` (${r.year})` : '') +
    (bits.length ? ` · ${bits.join(' · ')}` : '')
  );
}

function placesOf(r) {
  return buildingTree(r.buildings).map((n) => n.name).join(', ');
}

function holdingLine(r) {
  const lib = LIBRARIES[libraryOfId(r.id)];
  const places = placesOf(r);
  return `${lib.name} [${r.id}]${places ? `: ${places}` : ''} — ${recordUrl(r.id)}`;
}

export function formatSearch(result, opts) {
  const { resultCount, groups } = result;
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 10;
  const scope = opts.locations?.length
    ? opts.locations.join(', ')
    : (opts.libraries ?? LIBRARY_KEYS).map((k) => LIBRARIES[k].name).join(', ');
  const filters = [
    `format: ${opts.format ?? 'book'}`,
    opts.language && `language: ${opts.language}`,
    (opts.yearFrom != null || opts.yearTo != null) &&
      `years: ${opts.yearFrom ?? ''}–${opts.yearTo ?? ''}`,
  ].filter(Boolean).join(', ');
  const what = opts.query ? `"${opts.query}"` : 'everything';

  if (!groups.length) {
    return (
      `No results for ${what} in ${scope} (${filters})` +
      (page > 1 ? ` on page ${page}; ${resultCount} titles in total.` : '.') +
      (page === 1 && (opts.format ?? 'book') !== 'any'
        ? ' Try format "any", fewer filters, or another spelling.'
        : '')
    );
  }

  const first = (page - 1) * limit + 1;
  const lines = [
    `${resultCount} titles for ${what} in ${scope} (${filters}). ` +
      `Showing ${first}–${first + groups.length - 1}.`,
    '',
  ];
  groups.forEach(({ representative, holdings }, i) => {
    lines.push(`${first + i}. ${headline(holdings[0] ?? representative)}`);
    if (holdings.length) {
      for (const h of holdings) lines.push(`   ${holdingLine(h)}`);
    } else {
      lines.push(`   [${representative.id}] — ${recordUrl(representative.id)}`);
    }
  });
  lines.push('');
  if (first + groups.length - 1 < resultCount) {
    lines.push(`More results: page ${page + 1}.`);
  }
  lines.push(
    'Each line names a library system that owns the title, with the cities or ' +
      'campuses holding it. Whether a copy is on the shelf right now is not in ' +
      'the API: open the link. get_record gives full details and branches.',
  );
  return lines.join('\n');
}

function list(label, values) {
  const v = (values ?? []).filter(Boolean);
  return v.length ? `${label}: ${v.join('; ')}` : null;
}

export function formatRecord(r, siblings = new Map()) {
  const lib = libraryOfId(r.id);
  const subjects = (r.subjects ?? []).map((s) => s.join(' – '));
  const lines = [
    `${r.title || '(no title)'} [${r.id}]`,
    lib ? `Library system: ${LIBRARIES[lib].name} (${LIBRARIES[lib].about})` : null,
    list('Authors', r.primaryAuthors),
    list('Other contributors', r.secondaryAuthors),
    list('Organisations', r.corporateAuthors),
    r.year ? `Year: ${r.year}` : null,
    list('Publisher', [
      [...(r.placesOfPublication ?? []), ...(r.publishers ?? [])].join(' '),
    ]),
    r.edition ? `Edition: ${r.edition}` : null,
    list('Format', [formatName(r)]),
    list('Language', r.languages),
    list('Original language', r.originalLanguages),
    list('Physical description', r.physicalDescriptions),
    list('Series', (r.series ?? []).map((s) => s.name ?? s)),
    list('ISBN', r.isbns),
    list('Subjects', subjects),
    list('Genres', r.genres),
    list('Call numbers', r.callNumbers),
    list('Summary', r.summary),
    list('Online', (r.onlineUrls ?? []).map((u) => u.url).filter(Boolean)),
    `Page (shelf status, reservations): ${recordUrl(r.id)}`,
  ].filter(Boolean);

  const tree = buildingTree(r.buildings);
  if (tree.length) {
    lines.push('', 'Held at:');
    for (const node of tree) {
      const kids = node.children.map((c) => c.name).join(', ');
      lines.push(`- ${node.name} [${node.code}]${kids ? `: ${kids}` : ''}`);
    }
  }

  const others = (r.dedupIds ?? []).filter((id) => id !== r.id);
  const local = others.filter(libraryOfId);
  if (local.length) {
    lines.push('', 'Same title in the other Helsinki-area systems:');
    for (const id of local) {
      const s = siblings.get(id);
      lines.push(`- ${s ? holdingLine(s) : `[${id}] — ${recordUrl(id)}`}`);
    }
  }
  const elsewhere = others.length - local.length;
  if (elsewhere > 0) {
    lines.push(
      '',
      `Also in ${elsewhere} other Finnish library ` +
        `${elsewhere === 1 ? 'catalogue' : 'catalogues'} outside these three.`,
    );
  }
  return lines.join('\n');
}

export function formatLocations(library, tree, nameContains) {
  const needle = nameContains?.trim().toLocaleLowerCase('fi');
  const hit = (s) => !needle || s.toLocaleLowerCase('fi').includes(needle);
  const lines = [];
  for (const node of tree) {
    const kids = hit(node.name)
      ? node.children
      : node.children.filter((c) => hit(c.name));
    if (!hit(node.name) && !kids.length) continue;
    lines.push(`${node.name} [${node.code}]`);
    for (const c of kids) lines.push(`  ${c.name} [${c.code}]`);
  }
  const lib = LIBRARIES[library];
  if (!lines.length) {
    return `No ${lib.name} location matches "${nameContains}".`;
  }
  return [
    `${lib.name} locations (${lib.about}). Pass a code in brackets as ` +
      '"locations" to search_libraries.',
    '',
    ...lines,
    '',
    'Collected from a sample of records, so small or rarely used locations ' +
      'may be missing.',
  ].join('\n');
}
