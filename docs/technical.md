# Technical notes

How the server is built, what its tools accept, and what was verified about
the Finna API. For what the server is and how to install it, see
[../README.md](../README.md).

## Layout

- `src/finna.js`: API client, resolution of local copies, shelf-status parser
  and text formatting. No MCP code, so it can be tested on its own.
- `src/server.js`: the MCP tool definitions and server instructions.
- `test/finna.test.js`: offline tests (`npm test`). The network is replaced by
  a fake `fetch`; the shelf-status test holds a trimmed sample of real markup.
- `.mcp.json`: registers the server as `finna-libraries` for this directory.

Plain JavaScript (ES modules), no build step, Node 20 or newer. Dependencies:
`@modelcontextprotocol/sdk` and `zod`. Transport is stdio only.

## Tools

All four tools are read-only and return plain text. Expected failures (unknown
location, bad code, the API being down) come back as tool errors whose text
says how to recover.

### `search_catalogue`

| Parameter | Default | Notes |
|---|---|---|
| `query` | empty | Words, a title, a name, a topic or an ISBN. `AND`, `OR`, `NOT` and quoted phrases work. Empty browses by filters only. |
| `search_in` | `all` | `all`, `title`, `author`, `subject`. Author names work in either order. |
| `libraries` | all three | Any of `helmet`, `helka`, `3amk`. |
| `locations` | none | Up to 20 names or codes; several are alternatives. See below. |
| `format` | `book` | `any`, `book`, `printed_book`, `ebook`, `audiobook`, `sound`, `video`, `musical_score`, `journal`, `thesis`, `game`, `map`. `book` covers printed books, e-books and audiobooks. |
| `language` | none | Three-letter code (`fin`, `swe`, `eng`). Common two-letter codes and `ger`, `fre`, `chi` are translated. |
| `year_from`, `year_to` | none | Publication years, inclusive. |
| `sort` | `relevance` | `relevance`, `newest`, `oldest` (publication year), `title`, `author`. |
| `page`, `limit` | 1, 10 | `limit` is at most 50. |

Each result is one title with a line per library system that owns it: the
record ID in brackets, the cities or campuses holding it, and the record's web
address. When there are more results than shown, the footer gives counts by
language, and by format when `format` is `any`, to narrow with.

**Locations by name.** A name is matched against the location list of the
systems being searched (see [Location list](#location-list)):

- A city or campus with exactly that name is used alone: "Helsinki" means
  `1/Helmet/h/`, not every branch with Helsinki in its name.
- Otherwise every location that has the name as whole words matches. "Oodi"
  gives both "Oodi" and "Oodi lapset", which are separate codes in Finna.
  "Pasila" gives the Helmet branch and Haaga-Helia Pasila.
- A hyphenated name is one word, so "Haaga" does not match "Haaga-Helia" or
  "Etelä-Haaga".
- No match is an error that lists similar names. More than 12 matches is an
  error asking for a more specific name.

A code (`1/Helmet/h/`, `2/Helmet/h/h00l/`) is checked for its form and its
library system only, not against the location list. A location outside the
given `libraries` is an error.

### `check_availability`

`ids`: 1 to 10 record IDs. For each record: copies available out of the total,
reservations waiting, the locations where it is in with their shelf marks, the
locations where it is not, and the record's web address. See
[Live shelf status](#live-shelf-status) for where this comes from.

### `get_record`

`ids`: 1 to 10 record IDs. Returns authors, publisher, edition, format,
languages, uniform title, ISBN, subjects, genres, call numbers, the branches
holding it with their codes, and the same title in the other two systems. IDs
that do not exist are reported inline; if none exist the call is an error.

### `list_locations`

`library`: one of `helmet`, `helka`, `3amk`. `name_contains`: optional filter.
Returns cities or campuses with their branches, each with its code.

## How the three systems appear in Finna

Each system sends its own records to Finna. The record ID starts with the
system it came from, which also tells whose library card is needed:

| ID prefix | System | Top-level `building` code |
|---|---|---|
| `helmet.` | Helmet | `0/Helmet/` |
| `helka.` | Helka | `0/HELKA/` |
| `3amk.` | 3AMK | `0/3AMK/` |

Below the top level, `building` codes have two more levels. Level 1 is a city
or campus (`1/Helmet/h/` Helsinki, `e` Espoo, `v` Vantaa, `k` Kauniainen;
`1/HELKA/KAISA/`; `1/3AMK/HHPAS/`). Level 2 is a branch or a section of one
(`2/Helmet/h/h00/` Oodi, `2/Helmet/h/h00l/` Oodi lapset, the children's
section). All three levels work as filters.

### Merged results

The same book has one record per system that owns it. Finna's search merges
these and returns one representative record per group, which is often from a
library outside Helsinki even when the search is filtered to the three
systems. The Helsinki-area copies are then only in the representative's
`dedupIds`, and its `buildings` are its own.

The server resolves this: after a search it fetches the Helmet, Helka and 3AMK
records named in `dedupIds` and shows those, always in that order. A search
therefore costs one `/search` call and usually one `/record` call.

`/record` does not return `dedupIds`. To find the other systems' copies of a
known record, the server searches with `filter[]=~local_ids_str_mv:"<id>"`.

## Finna API behaviour

Base: `https://api.finna.fi/v1`, endpoints `/search` and `/record`. JSON, no
key, no registration. The terms of use state no rate limit.

Verified with curl on 18 November 2026:

- `filter[]=~building:"…"` repeated gives OR across systems or locations.
- Other working filters: `format:"0/Book/"` (also `1/Book/Book/`,
  `1/Book/eBook/`, `1/Book/AudioBook/`), `language:"fin"`,
  `search_daterange_mv:"[2010 TO *]"`.
- `/record` takes many `id[]` values (60 tested) and silently skips unknown
  IDs. A single unknown `id` gives HTTP 400.
- `facet[]=building` returns only level 0, with or without `facetFilter[]`, so
  branches cannot be listed that way.
- There is no live shelf status anywhere in the API.
- Record pages: `https://helmet.finna.fi/Record/<id>` and
  `https://helka.finna.fi/Record/<id>` answer 200.
  `https://3amk.finna.fi/Record/<id>` answered 403, so 3AMK links use
  `https://www.finna.fi/Record/<id>`.

Verified on 19 November 2026:

- `type=Author` gives the same results for "Edward Tufte" and "Tufte, Edward".
- An ISBN as `lookfor` finds the record, with or without hyphens.
- `facet[]=language` and `facet[]=format` return counts for the filtered
  search at no measurable cost.
- `sort=first_indexed desc` orders merged groups by any member library's date,
  so it does not mean "new at this branch". It is not offered as a sort.
- `lng=en-gb` gives English names for libraries and formats.
- The library directory `https://api.kirjastot.fi/v4/library` returns
  addresses and opening hours (`with=schedules`). The server does not use it.

## Live shelf status

The API has no shelf status. The Finna website's record pages load it from

```
https://www.finna.fi/AJAX/JSON?method=getItemStatuses&lng=en-gb&id[]=<id>&id[]=<id>
```

One call there answers for Helmet, Helka and 3AMK records alike. On 19
November 2026 `helka.finna.fi` returned an HTML page for the same request and
`3amk.finna.fi` 403, so the server always uses `www.finna.fi`.

What to know about this endpoint:

- **It is not part of the documented API.** `https://www.finna.fi/robots.txt`
  disallows `/AJAX/` for all crawlers. The server is not a crawler: it makes
  one request when a person asks about specific titles, and it identifies
  itself with its own User-Agent. Using the endpoint was the owner's decision.
- **The answer is website markup.** Counts and shelf marks are only in the
  HTML of each status's `full_status` field. `parseItemStatus` picks them out
  by class name (`available-total`, `total`, `reservations`,
  `groupLocation status-…`, `groupCallnumber`). A change to the website's
  templates can break it.
- **It is slow.** The website asks each library's own system per record.
  Twenty records took 5.4 seconds, so the tool takes at most 10 per call.
- **User-Agent matters.** curl's default User-Agent got 403; the server's own
  got 200.

Things the data does and does not say:

- A row is a location with a status, not one copy; the counts in the header
  are per copy.
- Some Helka rows are labelled with a loan period only ("28 days") and no
  branch. The server compares each row with the branches the catalogue lists
  for the record, marks the rows it cannot place as `[branch not named]`, and
  prints the catalogue's branches next to them.
- A copy can be "available" while reservations are waiting. The output says
  such a copy may be set aside.
- There are no due dates.
- In Helmet location names, "aik" is the adult section and "las" the
  children's.

To run without the tool, so that the server only uses the open API, start it
with `FINNA_AVAILABILITY=0`:

```fish
claude mcp add --scope user --env FINNA_AVAILABILITY=0 finna-libraries -- node /Users/ari/github/search-api.finna.fi/src/server.js
```

## Location list

The API cannot list branches, so `list_locations` and the name lookup in
`search_catalogue` build the list from a sample: up to four pages of 100
records per system, collecting every `building` value seen. On 19 November
2026 this found 153 Helmet branches and sections and 17 3AMK campuses. Small
or rarely used locations can be missing. The list is kept in memory for the
life of the server process, so the first search by name takes about three
seconds and later ones do not.

## Trying the API by hand (fish shell)

The record ID is the last part of the record's web address:

- `https://helmet.finna.fi/Record/helmet.2573256` → `helmet.2573256`
- `https://helka.helsinki.fi/discovery/fulldisplay?...&id=994895613506253...`
  → `helka.994895613506253` (the number, prefixed with `helka.`)

A book in Helmet (*Taylor Swift : supertähti*, Carolyn McHugh, 2024):

```fish
curl -sS 'https://api.finna.fi/v1/record?id=helmet.2573256' | jq .
```

A book in Helka (*Envisioning information*, Edward R. Tufte, 1991 reprint):

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

## References

- OpenAPI spec: https://api.finna.fi/api/v1/?openapi
- Swagger UI: https://api.finna.fi/swagger-ui/?url=%2Fapi%2Fv1%3Fswagger
- Terms of use (CC0 metadata; naming Finna and the providing organisations is
  recommended):
  https://www.kiwi.fi/spaces/Finna/pages/53839699/Finna+API+Terms+of+Use
