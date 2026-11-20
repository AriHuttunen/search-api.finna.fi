// Finna API client and result formatting for the three Helsinki-area library
// systems. No MCP code in here, so it can be tested and reused on its own.

import { readFileSync } from 'node:fs';

// The version is written once, in package.json.
export const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

export const API_BASE = 'https://api.finna.fi/v1';
// Live shelf status is not in the API. The website's record pages load it from
// this endpoint, which covers all three systems. See fetchAvailability.
export const STATUS_URL = 'https://www.finna.fi/AJAX/JSON';
// Name and version only: www.finna.fi answered 403 when the repository address
// was added in brackets (docs/technical.md).
export const USER_AGENT = `finna-helsinki-libraries-mcp/${VERSION}`;
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

// Finna indexes languages by three-letter code. People and models often write
// the two-letter one, or the older bibliographic three-letter one.
const LANGUAGE_ALIASES = {
  fi: 'fin', sv: 'swe', en: 'eng', ru: 'rus', et: 'est', de: 'deu', fr: 'fra',
  es: 'spa', it: 'ita', so: 'som', ar: 'ara', zh: 'zho', ja: 'jpn', se: 'sme',
  ger: 'deu', fre: 'fra', chi: 'zho',
};

/** Returns the three-letter code Finna filters on, e.g. "fi" or "FIN" → "fin". */
export function normaliseLanguage(raw) {
  const code = String(raw).trim().toLowerCase();
  if (!/^[a-z]{2,3}$/.test(code)) {
    throw new FinnaError(
      `"${raw}" is not a language code. Use three letters, e.g. fin, swe, eng.`,
    );
  }
  if (LANGUAGE_ALIASES[code]) return LANGUAGE_ALIASES[code];
  if (code.length === 2) {
    throw new FinnaError(
      `Language "${raw}" is not known by its two-letter code here. Use the ` +
        'three-letter code, e.g. fin, swe, eng, rus, est.',
    );
  }
  return code;
}

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
  'originalLanguages', 'uniformTitles', 'formats', 'physicalDescriptions',
  'playingTimes', 'series', 'subjects', 'genres', 'targetAudienceNotes',
  'awards', 'summary', 'callNumbers', 'buildings', 'onlineUrls',
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
        '(a branch section). A plain name such as "Oodi" also works, and ' +
        'list_locations returns the valid codes.',
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

/** Which of the three systems a building code such as "1/HELKA/KAISA/" is in. */
function libraryOfCode(code) {
  const part = code.split('/')[1];
  return LIBRARY_KEYS.find((k) => LIBRARIES[k].code === part);
}

/** Builds the query string for /search from the tool's options. */
export function buildSearchParams(opts = {}) {
  const {
    query = '', searchIn = 'all', libraries = LIBRARY_KEYS, locations = [],
    format = 'book', language, yearFrom, yearTo, sort = 'relevance',
    page = 1, limit = 10, fields = SEARCH_FIELDS, facets = [],
  } = opts;

  const p = new URLSearchParams();
  p.set('lookfor', query);
  p.set('type', SEARCH_TYPES[searchIn]);
  p.set('sort', SORTS[sort]);
  p.set('page', String(page));
  p.set('limit', String(limit));
  p.set('lng', 'en-gb');

  // "~" makes the filters on one field alternatives (OR) instead of AND.
  const codes = locations.map(normaliseLocation);
  for (const code of codes) {
    const lib = libraryOfCode(code);
    if (!libraries.includes(lib)) {
      throw new FinnaError(
        `Location ${code} belongs to ${LIBRARIES[lib].name}, but "libraries" ` +
          `is limited to ${libraries.map((k) => LIBRARIES[k].name).join(', ')}. ` +
          'Leave "libraries" out or choose a location inside it.',
      );
    }
  }
  const buildings = codes.length
    ? codes
    : libraries.map((k) => `0/${LIBRARIES[k].code}/`);
  if (!buildings.length) throw new FinnaError('Choose at least one library.');
  for (const b of buildings) p.append('filter[]', `~building:"${b}"`);

  if (FORMATS[format]) p.append('filter[]', `format:"${FORMATS[format]}"`);
  if (language) {
    p.append('filter[]', `language:"${normaliseLanguage(language)}"`);
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
  for (const f of facets) p.append('facet[]', f);
  return p;
}

async function fetchJson(url, fetchImpl) {
  const host = new URL(url).host;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new FinnaError(`Could not reach ${host}: ${err.message}`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new FinnaError(`${host} answered HTTP ${res.status} without JSON.`);
  }
  return { res, body };
}

async function getJson(path, params, fetchImpl) {
  const { res, body } = await fetchJson(`${API_BASE}/${path}?${params}`, fetchImpl);
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

const fold = (s) => String(s).toLocaleLowerCase('fi').replace(/\s+/g, ' ').trim();
// "Haaga-Helia Pasila" has the words "haaga-helia" and "pasila": a hyphenated
// name stays one word, so "Haaga" does not pick every Haaga-Helia campus.
const wordsOf = (s) => ` ${fold(s).replace(/,/g, ' ').replace(/\s+/g, ' ')} `;

/**
 * Finds the locations a plain name refers to in a tree from listLocations.
 * A city or campus with exactly that name wins on its own. Otherwise every
 * location that has the name as whole words matches, so "Oodi" gives both
 * "Oodi" and "Oodi lapset", which are separate codes in Finna.
 */
export function matchLocations(name, tree) {
  const needle = wordsOf(name);
  const exact = tree.filter((n) => fold(n.name) === fold(name));
  if (exact.length) return exact.map(({ code, name: n }) => ({ code, name: n }));
  const out = [];
  for (const node of tree) {
    if (wordsOf(node.name).includes(needle)) {
      out.push({ code: node.code, name: node.name });
      continue;
    }
    for (const c of node.children) {
      if (wordsOf(c.name).includes(needle)) out.push({ code: c.code, name: c.name });
    }
  }
  return out;
}

const isCode = (s) => /^\s*[012]\//.test(String(s));
const MAX_NAME_MATCHES = 12;

/**
 * Turns the "locations" a caller gave, codes or plain names, into
 * [{ code, name }]. Names are looked up in the given library systems only.
 */
export async function resolveLocations(inputs, libraries, fetchImpl = fetch) {
  const named = inputs.filter((x) => !isCode(x));
  let tree = [];
  if (named.length) {
    const trees = await Promise.all(
      libraries.map((k) => listLocations(k, fetchImpl)),
    );
    tree = trees.flat();
  }
  const scope = libraries.map((k) => LIBRARIES[k].name).join(', ');
  const out = [];
  for (const raw of inputs) {
    if (isCode(raw)) {
      const code = normaliseLocation(raw);
      out.push({ code, name: code });
      continue;
    }
    const hits = matchLocations(raw, tree);
    if (!hits.length) {
      const near = tree
        .flatMap((n) => [n, ...n.children])
        .filter((n) => fold(n.name).includes(fold(raw)))
        .slice(0, 6)
        .map((n) => n.name);
      throw new FinnaError(
        `No location named "${raw}" in ${scope}.` +
          (near.length ? ` Similar names: ${near.join(', ')}.` : '') +
          ' list_locations shows every name and code.',
      );
    }
    if (hits.length > MAX_NAME_MATCHES) {
      throw new FinnaError(
        `"${raw}" matches ${hits.length} locations (${hits.slice(0, 5)
          .map((h) => h.name).join(', ')}, …). Use a more specific name, or ` +
          'codes from list_locations.',
      );
    }
    out.push(...hits);
  }
  const seen = new Set();
  return out.filter((h) => !seen.has(h.code) && seen.add(h.code));
}

export async function search(opts, fetchImpl = fetch) {
  const libraries = opts.libraries?.length ? opts.libraries : LIBRARY_KEYS;
  const places = await resolveLocations(opts.locations ?? [], libraries, fetchImpl);
  // Counts by language and format cost no extra request and tell the caller
  // how a long result list can be narrowed.
  const facets = [];
  if (!opts.language) facets.push('language');
  if ((opts.format ?? 'book') === 'any') facets.push('format');
  const params = buildSearchParams({
    ...opts, libraries, locations: places.map((p) => p.code), facets,
  });
  const body = await getJson('search', params, fetchImpl);
  const groups = await resolveHoldings(body.records ?? [], fetchImpl);
  return {
    resultCount: body.resultCount ?? 0, groups, places, facets: body.facets ?? {},
  };
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
  if (!found.length) {
    throw new FinnaError(
      `No record with ID ${ids.map((id) => `"${id}"`).join(', ')}. IDs are ` +
        'shown in brackets by search_catalogue, e.g. "helmet.2573256".',
    );
  }

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

// ------------------------------------------------------------- availability

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const plain = (html) => String(html)
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  // A fragment cut out of a larger page can end inside a tag.
  .replace(/<[^>]*$/, ' ')
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  })
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Reads one entry of the website's getItemStatuses answer. The numbers and
 * shelf marks only come as an HTML fragment (`full_status`), the same one the
 * record page shows, so this picks them out by class name.
 */
export function parseItemStatus(status) {
  const html = String(status.full_status ?? '')
    .split(/<div class="(?:actions|external-interface-link)|<script/)[0];
  const count = (re) => {
    const m = re.exec(html);
    return m ? Number(m[1]) : null;
  };
  const locations = [];
  for (const chunk of html.split(/class="groupLocation status-/).slice(1)) {
    const state = /^([\w-]+)/.exec(chunk)?.[1] ?? '';
    const [where, shelf = ''] = chunk.split(/class="groupCallnumber"[^>]*>/);
    const name = plain(where.replace(/^[^>]*>/, ''));
    locations.push({
      name: name === 'none' ? '' : name,
      available: state === 'available',
      shelf: plain(shelf).replace(/^[^:()]{1,12}:\s*/, ''),
    });
  }
  return {
    id: status.id,
    known: !status.missing_data && (locations.length > 0 || /class="total"/.test(html)),
    available: count(/class="available-total[\s\S]*?<span>\s*(\d+)/) ??
      (locations.length ? 0 : null),
    total: count(/class="total">[^<\d]*(\d+)/),
    reservations: count(/class="reservations">[^<\d]*(\d+)/),
    locations,
  };
}

/**
 * Live shelf status of records, from the website rather than the API: the
 * API has none. One request covers all IDs, but the website asks each
 * library's own system per record, so it is slow (about a quarter of a second
 * per record when measured) and should be used for a handful of records.
 */
export async function fetchAvailability(ids, fetchImpl = fetch) {
  const p = new URLSearchParams({ method: 'getItemStatuses', lng: 'en-gb' });
  for (const id of ids) p.append('id[]', id);
  const [{ res, body }, titles] = await Promise.all([
    fetchJson(`${STATUS_URL}?${p}`, fetchImpl),
    fetchRecords(ids, ['id', 'title', 'year', 'buildings'], fetchImpl),
  ]);
  const statuses = body?.data?.statuses;
  if (!res.ok || !Array.isArray(statuses)) {
    throw new FinnaError(
      `www.finna.fi did not return shelf status (HTTP ${res.status}). The ` +
        'record links from search_catalogue show it in a browser.',
    );
  }
  const byId = new Map(statuses.map((s) => [s.id, parseItemStatus(s)]));
  return ids.map((id) => ({
    ...(byId.get(id) ?? { id, known: false, locations: [] }),
    record: titles.get(id) ?? null,
  }));
}

export function formatAvailability(entries, now = new Date()) {
  const blocks = entries.map((e) => {
    const lib = libraryOfId(e.id);
    const title = e.record
      ? `${e.record.title || '(no title)'}${e.record.year ? ` (${e.record.year})` : ''} `
      : '';
    const head = `${title}[${e.id}]${lib ? ` — ${LIBRARIES[lib].name}` : ''}`;
    if (!e.record && !e.known) return `${head}\nNo record with this ID.`;
    if (!e.known) {
      return `${head}\nNo shelf status for this record (usual for e-books ` +
        `and other online material). Page: ${recordUrl(e.id)}`;
    }
    const on = e.locations.filter((l) => l.available);
    const off = e.locations.filter((l) => !l.available);
    const copies = e.total == null
      ? `${e.available ?? 0} available`
      : `${e.available ?? 0} of ${e.total} ${e.total === 1 ? 'copy' : 'copies'} available`;
    const queue = e.reservations
      ? `, ${e.reservations} ${e.reservations === 1 ? 'reservation' : 'reservations'}`
      : '';
    // The website labels some rows with a loan period only ("28 days"), so
    // the branch cannot be read from them. Those are marked, and the branches
    // the catalogue lists for the record are given instead of a guess.
    const branches = buildingTree(e.record?.buildings)
      .flatMap((n) => [n.name, ...n.children.map((c) => c.name)]);
    const unnamed = (l) => l.name && branches.length > 0 &&
      !branches.some((b) => fold(l.name).includes(fold(b).replace(/ lapset$/, '')));
    const label = (l) => (l.name || '(no branch)') + (unnamed(l) ? ' [branch not named]' : '');
    const place = (l) => label(l) + (l.shelf ? ` (shelf ${l.shelf})` : '');
    const lines = [head, `${copies}${queue}.`];
    if (on.length) lines.push(`Available at: ${on.map(place).join('; ')}`);
    if (off.length) {
      lines.push(`Not available now at: ${off.map((l) => (l.name ? label(l) : l.shelf || '(no branch)')).join('; ')}`);
    }
    if (e.locations.some(unnamed)) {
      lines.push(
        'A row marked [branch not named] carries no branch in the source. ' +
          `The catalogue lists this record at: ${buildingTree(e.record.buildings)
            .map((n) => n.name).join(', ')}.`,
      );
    }
    if (e.reservations && e.available) {
      lines.push('Copies shown as available may be set aside for the reservations.');
    }
    lines.push(`Reserve or see due dates: ${recordUrl(e.id)}`);
    return lines.join('\n');
  });
  const stamp = now.toLocaleString('en-GB', {
    timeZone: 'Europe/Helsinki', dateStyle: 'medium', timeStyle: 'short',
  });
  const helmet = entries.some((e) => libraryOfId(e.id) === 'helmet' && e.known);
  blocks.push(
    `Live status from www.finna.fi, read ${stamp} Helsinki time.` +
      (helmet ? ' In Helmet names, "aik" is the adult section and "las" the children\'s.' : ''),
  );
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------- locations

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

/** "language: fin 629, swe 294 · format: book 1750" from the facet counts. */
function refineLine(facets = {}) {
  const formatKey = (value) =>
    Object.keys(FORMATS).find((k) => FORMATS[k] === value);
  const parts = [];
  const langs = (facets.language ?? []).slice(0, 6)
    .map((f) => `${f.value} ${f.count}`);
  if (langs.length > 1) parts.push(`language: ${langs.join(', ')}`);
  const formats = (facets.format ?? [])
    .map((f) => [formatKey(f.value), f.count]).filter(([k]) => k).slice(0, 6)
    .map(([k, n]) => `${k} ${n}`);
  if (formats.length > 1) parts.push(`format: ${formats.join(', ')}`);
  return parts.length ? `Narrow with ${parts.join(' · ')}.` : null;
}

/**
 * `opts.availability` says whether the check_availability tool exists, so the
 * closing hint only names tools the caller can use.
 */
export function formatSearch(result, opts) {
  const { resultCount, groups } = result;
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 10;
  const scope = result.places?.length
    ? result.places.map((p) => p.name).join(', ')
    : (opts.libraries?.length ? opts.libraries : LIBRARY_KEYS)
      .map((k) => LIBRARIES[k].name).join(', ');
  const filters = [
    `format: ${opts.format ?? 'book'}`,
    opts.language && `language: ${normaliseLanguage(opts.language)}`,
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
    `${resultCount} ${resultCount === 1 ? 'title' : 'titles'} for ${what} ` +
      `in ${scope} (${filters}). ` +
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
    const refine = refineLine(result.facets);
    lines.push(`More results: page ${page + 1}.${refine ? ` ${refine}` : ''}`);
  }
  lines.push(
    'Each line names a library system that owns the title, with the cities or ' +
      'campuses holding it; this says who owns a copy, not whether it is in. ' +
      (opts.availability
        ? 'check_availability gives the live shelf status of the bracketed IDs. '
        : 'For shelf status open the link. ') +
      'get_record gives full details and branches.',
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
    list('Uniform title', r.uniformTitles),
    list('Physical description', r.physicalDescriptions),
    list('Playing time', r.playingTimes),
    list('Series', (r.series ?? []).map((s) => s.name ?? s)),
    list('ISBN', r.isbns),
    list('Subjects', subjects),
    list('Genres', r.genres),
    list('Audience', r.targetAudienceNotes),
    list('Awards', r.awards),
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
    `${lib.name} locations (${lib.about}). search_catalogue takes a name ` +
      'or a code in brackets as "locations".',
    '',
    ...lines,
    '',
    'Collected from a sample of records, so small or rarely used locations ' +
      'may be missing.',
  ].join('\n');
}
