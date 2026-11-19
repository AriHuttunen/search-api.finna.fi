# MCP server: Helsinki-area libraries via the Finna API

A local stdio MCP server that searches Helmet, Helka and 3AMK through the open
Finna API. Background on the libraries and setup instructions are in
`README.md`.

## Layout

- `src/finna.js` — API client, dedup resolution and text formatting. No MCP code.
- `src/server.js` — tool definitions (`search_libraries`, `get_record`,
  `list_locations`).
- `test/finna.test.js` — offline tests (`npm test`); the network is faked.
- `.mcp.json` — registers the server as `finna-libraries` for this directory.

Plain JavaScript (ES modules), no build step. Node 20+.

## API facts, verified with curl on 18 November 2026

- `https://api.finna.fi/v1/search` and `/v1/record`, JSON, no key. Metadata is
  CC0. Spec: https://api.finna.fi/api/v1/?openapi
- Top-level `building` codes: `0/Helmet/`, `0/HELKA/`, `0/3AMK/`. Level 1 is a
  city or campus (`1/Helmet/h/` Helsinki, `e` Espoo, `v` Vantaa, `k`
  Kauniainen; `1/HELKA/KAISA/`; `1/3AMK/HHPAS/`), level 2 a branch section
  (`2/Helmet/h/h00l/` Oodi lapset). All three levels work as filters.
- `filter[]=~building:"…"` repeated gives OR across systems or locations.
- Other working filters: `format:"0/Book/"` (also `1/Book/Book/`,
  `1/Book/eBook/`, `1/Book/AudioBook/`), `language:"fin"`,
  `search_daterange_mv:"[2010 TO *]"`.
- Search merges the same title across all Finnish libraries and returns one
  representative record, often from outside Helsinki. The Helsinki-area copies
  are in its `dedupIds`. The representative's `buildings` are its own only.
- `/v1/record` does not return `dedupIds`. To find a record's group, search
  with `filter[]=~local_ids_str_mv:"<id>"`.
- `/v1/record` takes many `id[]` values (60 tested) and silently skips unknown
  IDs. A single unknown `id` gives HTTP 400.
- `facet[]=building` returns only level 0, with or without `facetFilter[]`, so
  branches cannot be listed that way. `list_locations` samples records instead.
- No live shelf availability anywhere in the API.
- Record pages: `https://helmet.finna.fi/Record/<id>` and
  `https://helka.finna.fi/Record/<id>` answer 200;
  `https://3amk.finna.fi/Record/<id>` answered 403, so 3AMK uses
  `https://www.finna.fi/Record/<id>`.

## Not checked

- Rate limits. The terms page was not read in this session:
  https://www.kiwi.fi/spaces/Finna/pages/53839699/Finna+API+Terms+of+Use

## Decisions

- The unofficial server at https://github.com/samuli/finna-mcp (Cloudflare
  Workers) was considered and not wanted; this one runs locally.
- Phone use goes through Claude Code Remote Control on an always-on Mac mini,
  with MCP servers registered at user scope there (steps in `README.md`). A
  public HTTP endpoint or tunnel for a claude.ai connector was not wanted.
- Anything behind a library card (reservations, loans) is out of scope; it
  would need browser automation on the library websites.

## User preferences

- Based in Helsinki; metric units, euros.
- Show source links in full so the destination is visible.
