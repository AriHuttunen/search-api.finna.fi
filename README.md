# Searching Helsinki-area libraries via the Finna API

Finna (https://finna.fi) is a shared national search across Finnish libraries,
archives and museums. It is not a library itself: every book belongs to the
library system that bought it and sits on a shelf in one of that system's
buildings.

## MCP server

This directory contains an MCP server that lets Claude (or any MCP client)
search all three Helsinki-area library systems at once. It runs locally over
stdio, needs no API key and only reads from `https://api.finna.fi`.

| Tool | What it does |
|---|---|
| `search_libraries` | Search by words, title, author or subject. Filters: library system, city/campus/branch, format, language, publication years. Each result lists the systems that own the title, their record IDs, the cities or campuses holding it and a link. |
| `get_record` | Full details of a record: authors, publisher, ISBN, subjects, call numbers, every branch holding it, and the same title in the other two systems. |
| `list_locations` | Cities, campuses and branches of one system, with the codes `search_libraries` accepts. |

Searches cover books (printed, e-books, audiobooks) unless another `format` is
given.

### Setup

Needs Node.js 20 or newer.

```fish
cd /Users/ari/github/search-api.finna.fi
npm install
npm test
```

**Claude Code, in this directory:** `.mcp.json` already registers the server as
`finna-libraries`. Start `claude` here and approve it when asked.

**Claude Code, everywhere:**

```fish
claude mcp add --scope user finna-libraries -- node /Users/ari/github/search-api.finna.fi/src/server.js
```

**Claude desktop app:** add this to
`~/Library/Application Support/Claude/claude_desktop_config.json` and restart
the app. If the app cannot find `node`, write its full path
(`/opt/homebrew/bin/node`).

```json
{
  "mcpServers": {
    "finna-libraries": {
      "command": "node",
      "args": ["/Users/ari/github/search-api.finna.fi/src/server.js"]
    }
  }
}
```

### Using it from the iPhone (Remote Control)

The Claude app on iPhone cannot reach a local stdio server from a normal chat.
Instead, the chats run as Claude Code sessions on a Mac that stays online (the
Mac mini) and are driven from the phone with Remote Control. The session runs
on the Mac, so it uses the MCP servers configured in Claude Code there. Nothing
is exposed to the internet and the server needs no changes.

Do these once on the Mac that stays online. Steps 1 to 3 are repeated for every
MCP server the phone chats should have.

1. **Register the server at user scope, with absolute paths.** `.mcp.json`
   here only applies to sessions started in this directory, and its path is
   relative. User scope makes the server available in every folder:

   ```fish
   claude mcp add --scope user finna-libraries -- node /Users/ari/github/search-api.finna.fi/src/server.js
   claude mcp list
   ```

   Adjust the path if the repository is somewhere else on that Mac. If the
   server does not start because `node` is not found, use its full path
   (`/opt/homebrew/bin/node`).

2. **Pre-approve the server's tools**, so that each call does not wait for a
   permission tap on the phone. In `~/.claude/settings.json`, one entry per
   server:

   ```json
   {
     "permissions": {
       "allow": ["mcp__finna-libraries"]
     }
   }
   ```

   This server only reads public data, so allowing it outright is low risk.
   Leave servers that can write, send or buy things on prompting.

3. **Sign in to servers that need a login while sitting at the Mac.** The
   browser sign-in cannot be completed from the phone. `finna-libraries` needs
   none.

4. **Serve one general-purpose folder with Remote Control**, for example
   `~/chats`. With every server at user scope the folder no longer decides
   which MCP servers a chat gets.

   ```fish
   mkdir -p ~/chats
   cd ~/chats
   claude remote-control
   ```

5. **On the iPhone**, open the Claude app, go to Code and pick the Mac's
   session or start a new one there.

Keep the Mac awake (System Settings → Energy: prevent automatic sleeping) and
Remote Control running; nothing works from the phone while either is off.

Not tested when this was written: steps 4 and 5, including whether new
sessions can be started from the phone or only ones begun on the Mac
continued. Steps 1 and 2 are standard Claude Code configuration.

### Limits

- No shelf status. The API says which libraries own a title, not whether a
  copy is in right now; every result carries a link to the page that does.
- No reservations or loans: those need a library card login on the website.
- `list_locations` is built from a sample of records, because the API does not
  list branches. Small locations can be missing.
- 3AMK links go to `https://www.finna.fi` because `https://3amk.finna.fi`
  refused the test requests.

### Files

- `src/finna.js` — API calls and text formatting, no MCP code.
- `src/server.js` — the three MCP tools.
- `test/finna.test.js` — offline tests with a fake network.

## Physical libraries in the Helsinki area

There are three separate library systems. Each has its own buildings, its own
library card and its own collection. A card from one does not borrow from the
others, and books do not travel between systems.

| System | Run by | Physical libraries | Who it is for |
|---|---|---|---|
| Helmet | Cities of Helsinki, Espoo, Vantaa and Kauniainen | The neighbourhood public libraries, e.g. Oodi, Pasila, Sello, Tikkurila | Everyone; one card works in all four cities and books can be sent between branches |
| Helka | University of Helsinki | Campus libraries: Kaisa House (city centre), Kumpula, Meilahti, Viikki | Mainly students and researchers, open to the public |
| 3AMK | Haaga-Helia, Laurea and Metropolia universities of applied sciences | One library per campus, e.g. Haaga-Helia Pasila, Metropolia Arabia | Mainly their students and staff, open to the public |

Inside a building, books are split into sections, for example the children's
section ("lapset") at Oodi or the general collection at Haaga-Helia Pasila.

### Getting a library card

Checked from the libraries' own pages on 18 November 2026. No price was stated
for either card, so whether they are free is not confirmed.

**Helka (University of Helsinki library)**

- Open to anyone over 15 with valid ID and a street address in Finland
  (no PO box or foreign address).
- Fill in the online library card form, then collect the card with photo ID at
  the library location you chose. The personal identity code is also asked for.
- https://www.helsinki.fi/en/helsinki-university-library/library-services/library-card-and-logging-helka
- https://www.helsinki.fi/en/helsinki-university-library/welcome-library/library-everyone

**3AMK (Haaga-Helia, Laurea, Metropolia)**

- You do not need to be a student at any of the three.
- Either walk into any 3AMK campus library, or fill in Metropolia's online form
  and collect the card from any 3AMK library within two working days. Bring ID.
- One card works in all three; loans can be returned to any of them.
- Some materials are lent only to the school's own students and staff.
- https://elomake.metropolia.fi/lomakkeet/31507/lomake.html
- https://libguides.metropolia.fi/library_user/borrow
- https://libguides.haaga-helia.fi/library-services/library-card

## How the systems show up in Finna

Each system sends its own records to Finna. The record ID starts with the
system it came from, and that tells you whose card you need:

| ID prefix | System | Top-level `building` code |
|---|---|---|
| `helmet.` | Helmet | `0/Helmet/` |
| `helka.` | Helka | `0/HELKA/` |
| `3amk.` | 3AMK | `0/3AMK/` |

The same book has one record per system that owns it. Finna's search merges
these duplicates and shows only one per group, so a result list undercounts who
holds a book. The full list of holders is in the `dedupIds` field.

The one record shown can belong to a library outside Helsinki even when the
search is filtered to Helsinki-area systems; the local copy is then only in
`dedupIds`. The MCP server resolves this and always shows the local copies.
`dedupIds` comes back from `/v1/search` only, not from `/v1/record`.

The API shows which libraries own a copy, not whether it is on the shelf today.
For that, open the record page on the website.

## Examples: fetching a record by ID (fish shell)

The ID is the last part of the record's web address:

- `https://helmet.finna.fi/Record/helmet.2573256` → `helmet.2573256`
- `https://helka.helsinki.fi/discovery/fulldisplay?...&id=994895613506253...`
  → `helka.994895613506253` (the number, prefixed with `helka.`)

A book in Helmet (*Taylor Swift : supertähti*, Carolyn McHugh, 2024):

```fish
curl -sS 'https://api.finna.fi/v1/record?id=helmet.2573256' | jq .
```

A book in Helka (*Envisioning information*, Edward R. Tufte, 1991 reprint,
at Kaisa House; Helmet does not have this title):

```fish
curl -sS 'https://api.finna.fi/v1/record?id=helka.994895613506253' | jq .
```

Keep the single quotes around the URL: without them fish treats `?` as a
wildcard.

To choose which fields come back, add `field[]` parameters:

```fish
curl -sS -G 'https://api.finna.fi/v1/record' \
    -d id=helka.994895613506253 \
    -d lng=en-gb \
    --data-urlencode 'field[]=title' \
    --data-urlencode 'field[]=primaryAuthors' \
    --data-urlencode 'field[]=year' \
    --data-urlencode 'field[]=isbns' \
    --data-urlencode 'field[]=callNumbers' \
    --data-urlencode 'field[]=buildings' | jq .
```

`lng=en-gb` gives English names for libraries and formats; leave it out for
Finnish.

## API reference

- OpenAPI spec: https://api.finna.fi/api/v1/?openapi
- Swagger UI: https://api.finna.fi/swagger-ui/?url=%2Fapi%2Fv1%3Fswagger
- Terms of use (metadata is CC0, no registration):
  https://www.kiwi.fi/spaces/Finna/pages/53839699/Finna+API+Terms+of+Use
