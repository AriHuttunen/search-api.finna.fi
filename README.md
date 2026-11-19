# Helsinki-area libraries for Claude

An MCP server that lets Claude (or any MCP client) search the three library
systems of the Helsinki area at once and check whether a book is on the shelf
right now. It runs on your own computer, needs no account or API key, and only
reads public data from Finna (https://finna.fi), the shared national search of
Finnish libraries.

## Example

Asked on 19 November 2026:

> Is Visual Explanations by Tufte on the shelf anywhere?

Claude's answer, using this server:

> Yes, your best bet is the University of Helsinki (Helka), where both copies
> are in as of 19:38 Helsinki time today:
>
> - **Kaisa House:** one copy on the shelf at `Kielet Y Tufte`, 28-day loan.
> - **Probably Kumpula:** a second copy at shelf mark `004.12 Tufte`, 28-day
>   loan. The live status doesn't name the branch, but the catalogue lists the
>   title at Kaisa House and Kumpula.
> - **Record:** https://helka.finna.fi/Record/helka.9917282953506253
>
> Helmet's only copy is not a safe trip. It shows as available at Tapiola
> (adult section, shelf `75.13 TUF`), but there are 2 reservations on it, so it
> is likely set aside for someone in the queue. You can reserve it at
> https://helmet.finna.fi/Record/helmet.1556626.
>
> 3AMK doesn't own it. Helka and Helmet each need their own library card.

Other things to ask:

- "Which books by Edward Tufte can I borrow in Helsinki?"
- "What does Oodi have on design?"
- "Is Muumipappa ja meri available in Swedish, and where?"
- "Which library has ISBN 0961392126?"

## What it does

| Tool | What it does |
|---|---|
| `search_catalogue` | Finds titles by words, title, author, subject or ISBN. Can be narrowed to a library system, a city or branch by name ("Oodi", "Tapiola", "Kaisa House"), a format, a language or publication years. |
| `check_availability` | Live shelf status of chosen titles: copies in, reservations waiting, and the branches with their shelf marks. |
| `get_record` | Full details of a title: authors, publisher, ISBN, subjects, every branch holding it. |
| `list_locations` | The cities, campuses and branches of a library system. |

Searches cover books (printed, e-books, audiobooks) unless another format is
asked for.

## The three library systems

Each system has its own buildings, its own collection and its own library
card. A card from one does not borrow from the others, and books do not travel
between systems.

| System | Run by | Libraries | Who it is for |
|---|---|---|---|
| Helmet | Cities of Helsinki, Espoo, Vantaa and Kauniainen | The neighbourhood public libraries, e.g. Oodi, Pasila, Sello, Tikkurila | Everyone; one card works in all four cities |
| Helka | University of Helsinki | Campus libraries: Kaisa House, Kumpula, Meilahti, Viikki | Mainly students and researchers, open to the public |
| 3AMK | Haaga-Helia, Laurea and Metropolia | One library per campus, e.g. Haaga-Helia Pasila, Metropolia Arabia | Mainly their students and staff, open to the public |

The Helmet and Helka cards are free; how to get each of the three:
[docs/library-cards.md](docs/library-cards.md).

## Setup

Needs Node.js 20 or newer.

```fish
cd /Users/ari/github/search-api.finna.fi
npm install
npm test
```

**Claude Code, in every folder:**

```fish
claude mcp add --scope user finna-libraries -- node /Users/ari/github/search-api.finna.fi/src/server.js
```

**Claude Code, in this directory only:** `.mcp.json` already registers the
server as `finna-libraries`. Start `claude` here and approve it when asked.

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

**From an iPhone:** see [docs/phone.md](docs/phone.md).

After the server's code changes, start a new Claude session to load it.

## Limits

- It cannot reserve, renew or borrow. Those need a library card login on the
  library's website; every answer carries the link.
- Shelf status says what is in now, not when a loaned copy is due back.
- Some University of Helsinki copies are listed without their branch. The
  answer then says so instead of guessing.
- Different editions of the same work are separate results.
- Shelf status comes from the Finna website rather than its documented API, so
  it can stop working if the website changes. Search keeps working without it.
  Details and how to switch it off:
  [docs/technical.md](docs/technical.md#live-shelf-status).

## More documentation

- [docs/technical.md](docs/technical.md): tool parameters, how the server uses
  the Finna API, verified API behaviour, and curl examples.
- [docs/phone.md](docs/phone.md): using the server from an iPhone through
  Claude Code Remote Control.
- [docs/library-cards.md](docs/library-cards.md): getting a Helmet, Helka or
  3AMK card.

## Data

Catalogue data comes from Finna.fi and the libraries behind it: the Helmet
libraries, the Helsinki University Library and the 3AMK libraries. The
metadata is CC0. Terms of use:
https://www.kiwi.fi/spaces/Finna/pages/53839699/Finna+API+Terms+of+Use
