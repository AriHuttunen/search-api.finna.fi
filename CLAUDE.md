# MCP server: Helsinki-area libraries via the Finna API

A local stdio MCP server that searches Helmet, Helka and 3AMK through the open
Finna API and reads live shelf status from the Finna website.

## Documentation

- `README.md` — what the server does, an example, setup, limits. Kept short
  and readable for someone who has not seen the project.
- `docs/technical.md` — layout, tool parameters, how the server uses the API,
  verified API behaviour with dates, the shelf-status endpoint. New API
  findings go there, with the date they were verified.
- `docs/phone.md` — iPhone use through Remote Control.
- `docs/library-cards.md` — getting a Helmet, Helka or 3AMK card.

The technical notes are loaded with this file:

@docs/technical.md

## Decisions

- The unofficial server at https://github.com/samuli/finna-mcp (Cloudflare
  Workers) was considered and not wanted; this one runs locally.
- Phone use goes through Claude Code Remote Control on an always-on Mac mini,
  with MCP servers registered at user scope there (steps in `docs/phone.md`).
  A public HTTP endpoint or tunnel for a claude.ai connector was not wanted.
- Anything behind a library card (reservations, loans) is out of scope; it
  would need browser automation on the library websites.
- `check_availability` reads the website's item-status endpoint and is on by
  default, decided by the owner on 19 November 2026 knowing the robots.txt
  rule. `FINNA_AVAILABILITY=0` leaves the tool out.

## User preferences

- Based in Helsinki; metric units, euros.
- Show source links in full so the destination is visible.
