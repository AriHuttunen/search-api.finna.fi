#!/usr/bin/env node
// MCP server (stdio) for searching the Helsinki-area libraries through Finna.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  FORMATS, FinnaError, LIBRARY_KEYS, SEARCH_TYPES, SORTS,
  formatLocations, formatRecord, formatSearch, getRecords, listLocations, search,
} from './finna.js';

const server = new McpServer(
  { name: 'finna-helsinki-libraries', version: '0.1.0' },
  {
    instructions:
      'Searches the catalogues of the three Helsinki-area library systems ' +
      'through the open Finna API: Helmet (public libraries of Helsinki, Espoo, ' +
      'Vantaa and Kauniainen), Helka (University of Helsinki) and 3AMK ' +
      '(Haaga-Helia, Laurea, Metropolia). Each system needs its own library ' +
      'card. The API tells which libraries own a title, not whether a copy is ' +
      'on the shelf now; give the user the record link for that.',
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
  'search_libraries',
  {
    title: 'Search Helsinki-area libraries',
    description:
      'Search Helmet, Helka and 3AMK at once. Each result is one title with ' +
      'the systems that own it, their record IDs, the cities or campuses ' +
      'holding it, and a link. Searches books unless "format" says otherwise.',
    inputSchema: {
      query: z.string().default('').describe(
        'Search words. Supports AND, OR, NOT and "quoted phrases". May be ' +
          'empty to browse by filters only.',
      ),
      search_in: z.enum(keys(SEARCH_TYPES)).default('all').describe(
        'Which part of the record to match. For "author", write the name as ' +
          '"Jansson, Tove" or just the surname.',
      ),
      libraries: z.array(z.enum(keys({ helmet: 1, helka: 1, '3amk': 1 })))
        .min(1).default(LIBRARY_KEYS)
        .describe('Library systems to search. Default: all three.'),
      locations: z.array(z.string()).max(20).default([]).describe(
        'Narrow to cities, campuses or branches by code, e.g. "1/Helmet/h/" ' +
          '(Helsinki), "1/Helmet/e/" (Espoo), "1/Helmet/v/" (Vantaa), ' +
          '"1/Helmet/k/" (Kauniainen), "1/HELKA/KAISA/" (Kaisa House), ' +
          '"1/3AMK/HHPAS/" (Haaga-Helia Pasila). Replaces "libraries". ' +
          'list_locations returns all codes, including single branches.',
      ),
      format: z.enum(keys(FORMATS)).default('book').describe(
        '"book" covers printed books, e-books and audiobooks; "any" removes ' +
          'the limit.',
      ),
      language: z.string().optional().describe(
        'Three-letter language code of the item, e.g. fin, swe, eng, rus, est.',
      ),
      year_from: z.number().int().optional().describe('Earliest publication year.'),
      year_to: z.number().int().optional().describe('Latest publication year.'),
      sort: z.enum(keys(SORTS)).default('relevance'),
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
      limit: a.limit,
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
        .describe('Record IDs as shown in brackets by search_libraries.'),
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
      'Cities, campuses and branches of one library system with the codes ' +
      'that search_libraries accepts in "locations".',
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

await server.connect(new StdioServerTransport());
