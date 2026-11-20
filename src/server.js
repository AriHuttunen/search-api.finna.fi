#!/usr/bin/env node
// MCP server (stdio) for searching the Helsinki-area libraries through Finna.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  FORMATS, FinnaError, SEARCH_TYPES, SORTS, VERSION,
  fetchAvailability, formatAvailability, formatLocations, formatRecord,
  formatSearch, getRecords, listLocations, search,
} from './finna.js';

// Live shelf status is read from the Finna website, not the open API. It is on
// by default; FINNA_AVAILABILITY=0 leaves the tool out. docs/technical.md has the
// background.
const availability = !/^(0|false|no|off)$/i.test(process.env.FINNA_AVAILABILITY ?? '');

const server = new McpServer(
  { name: 'finna-helsinki-libraries', version: VERSION },
  {
    instructions:
      'Searches the catalogues of the three Helsinki-area library systems ' +
      'through the open Finna API: Helmet (public libraries of Helsinki, Espoo, ' +
      'Vantaa and Kauniainen), Helka (University of Helsinki) and 3AMK ' +
      '(Haaga-Helia, Laurea, Metropolia). Each system needs its own library ' +
      'card. search_catalogue tells which libraries own a title, not whether ' +
      'a copy is on the shelf now. Show record links as full URLs, not ' +
      'behind link text. ' +
      (availability
        ? 'For that, call check_availability with the record IDs of the few ' +
          'titles the user cares about.'
        : 'For that, give the user the record link.'),
  },
);

const text = (t) => ({ content: [{ type: 'text', text: t }] });

/** Runs a tool body and turns expected failures into a readable tool error. */
async function guarded(fn) {
  try {
    return text(await fn());
  } catch (err) {
    if (err instanceof FinnaError) {
      return { ...text(err.message), isError: true };
    }
    throw err;
  }
}

const readOnly = { readOnlyHint: true, openWorldHint: true };
const keys = (o) => /** @type {[string, ...string[]]} */ (Object.keys(o));

server.registerTool(
  'search_catalogue',
  {
    title: 'Search the Helsinki-area library catalogues',
    description:
      'Find books and other material in Helmet, Helka and 3AMK at once. Each ' +
      'result is one title with the systems that own it, their record IDs, ' +
      'the cities or campuses holding it, and a link. Searches books unless ' +
      '"format" says otherwise.',
    inputSchema: {
      query: z.string().default('').describe(
        'Search words: a title, a name, a topic or an ISBN. Supports AND, ' +
          'OR, NOT and "quoted phrases". May be empty to browse by filters ' +
          'only, e.g. the newest books of one branch.',
      ),
      search_in: z.enum(keys(SEARCH_TYPES)).default('all').describe(
        'Which part of the record to match. Author names work in either ' +
          'order ("Tove Jansson" or "Jansson, Tove").',
      ),
      libraries: z.array(z.enum(keys({ helmet: 1, helka: 1, '3amk': 1 })))
        .min(1).optional()
        .describe('Library systems to search. Default: all three.'),
      locations: z.array(z.string().min(1)).max(20).default([]).describe(
        'Narrow to cities, campuses or branches, by name ("Oodi", ' +
          '"Tapiola", "Espoo", "Kaisa House", "Haaga-Helia Pasila") or by ' +
          'code from list_locations ("2/Helmet/h/h00/"). A branch name ' +
          'includes its sections, such as the children\'s one. Several ' +
          'entries are alternatives. With "libraries", every location must ' +
          'be in one of those systems.',
      ),
      format: z.enum(keys(FORMATS)).default('book').describe(
        '"book" covers printed books, e-books and audiobooks; "any" removes ' +
          'the limit.',
      ),
      language: z.string()
        .regex(/^[A-Za-z]{2,3}$/, 'Use a three-letter language code, e.g. fin, swe, eng')
        .optional().describe(
          'Language of the item as a three-letter code, e.g. fin, swe, eng, ' +
            'rus, est. Common two-letter codes (fi, sv, en) also work.',
        ),
      year_from: z.number().int().optional().describe('Earliest publication year.'),
      year_to: z.number().int().optional().describe('Latest publication year.'),
      sort: z.enum(keys(SORTS)).default('relevance').describe(
        '"newest" and "oldest" go by publication year.',
      ),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(50).default(10)
        .describe('Results per page.'),
    },
    annotations: readOnly,
  },
  (a) => guarded(async () => {
    const opts = {
      query: a.query, searchIn: a.search_in, libraries: a.libraries,
      locations: a.locations, format: a.format, language: a.language,
      yearFrom: a.year_from, yearTo: a.year_to, sort: a.sort, page: a.page,
      limit: a.limit, availability,
    };
    return formatSearch(await search(opts), opts);
  }),
);

server.registerTool(
  'get_record',
  {
    title: 'Get library record details',
    description:
      'Full details of one or more records by ID (e.g. "helmet.2573256", ' +
      '"helka.994895613506253", "3amk.238373"): authors, publisher, ISBN, ' +
      'subjects, call numbers, every branch that holds it, and the same ' +
      'title in the other two systems.',
    inputSchema: {
      ids: z.array(z.string().regex(/^[\w-]+\.[\w.:-]+$/, 'Not a Finna record ID'))
        .min(1).max(10)
        .describe('Record IDs as shown in brackets by search_catalogue.'),
    },
    annotations: readOnly,
  },
  ({ ids }) => guarded(async () => {
    const { records, siblings } = await getRecords(ids);
    const parts = ids.map((id) =>
      records.has(id)
        ? formatRecord(records.get(id), siblings)
        : `No record with ID "${id}".`,
    );
    return parts.join('\n\n---\n\n');
  }),
);

server.registerTool(
  'list_locations',
  {
    title: 'List library locations',
    description:
      'Cities, campuses and branches of one library system, with their ' +
      'names and codes. search_catalogue accepts either in "locations", so ' +
      'this is for browsing what exists or telling apart similar names.',
    inputSchema: {
      library: z.enum(keys({ helmet: 1, helka: 1, '3amk': 1 })),
      name_contains: z.string().optional().describe(
        'Only locations whose name contains this, e.g. "Oodi" or "Pasila". ' +
          'Helmet has well over a hundred, so use this for Helmet.',
      ),
    },
    annotations: readOnly,
  },
  ({ library, name_contains }) => guarded(async () =>
    formatLocations(library, await listLocations(library), name_contains),
  ),
);

if (availability) {
  server.registerTool(
    'check_availability',
    {
      title: 'Check live shelf status',
      description:
        'Whether copies are on the shelf right now: for each record, how ' +
        'many copies are available, how many reservations are waiting, and ' +
        'the branches with their shelf marks. Reads the Finna website, which ' +
        'asks each library\'s own system, so it takes a few seconds: use it ' +
        'for the titles the user has picked, not for whole result lists.',
      inputSchema: {
        ids: z.array(z.string().regex(/^[\w-]+\.[\w.:-]+$/, 'Not a Finna record ID'))
          .min(1).max(10)
          .describe(
            'Record IDs as shown in brackets by search_catalogue. A title ' +
              'owned by several systems has one ID per system.',
          ),
      },
      annotations: readOnly,
    },
    ({ ids }) => guarded(async () =>
      formatAvailability(await fetchAvailability([...new Set(ids)]))),
  );
}

await server.connect(new StdioServerTransport());
