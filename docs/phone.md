# Using the server from an iPhone (Remote Control)

The Claude app on iPhone cannot reach a local stdio server from a normal chat.
Instead, the chats run as Claude Code sessions on a Mac that stays online (the
Mac mini) and are driven from the phone with Remote Control. The session runs
on the Mac, so it uses the MCP servers configured in Claude Code there. Nothing
is exposed to the internet and the server needs no changes.

## One-time setup on the Mac

Steps 1 to 3 are repeated for every MCP server the phone chats should have.

1. **Register the server at user scope, with absolute paths.** `.mcp.json`
   in this repository only applies to sessions started in its directory, and
   its path is relative. User scope makes the server available in every folder:

   ```fish
   claude mcp add --scope user finna-libraries -- node /path/to/search-api.finna.fi/src/server.js
   claude mcp list
   ```

   Replace `/path/to` with where the repository is on that Mac. If the
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

4. **Start Remote Control in the folder the chats should run in.** This setup
   uses `~/github`, the folder that holds the repositories, so a chat
   can also work on them.

   ```fish
   cd ~/github
   claude remote-control
   ```

   With every server at user scope the folder does not decide which MCP
   servers a chat gets. It does decide two other things: Claude's memory notes
   are kept per starting folder, and a repository's `CLAUDE.md` is read only
   once the chat works on files inside that repository.

5. **On the iPhone**, open the Claude app, go to Code and pick the Mac's
   session or start a new one there.

Keep the Mac awake (System Settings → Energy: prevent automatic sleeping) and
Remote Control running; nothing works from the phone while either is off.

Steps 1 and 2 are standard Claude Code configuration. Step 4 describes the
setup in use on 19 November 2026; the steps were not re-run from scratch to
check them.

## After the server's code changes

A running session keeps the server process it started with, so it does not see
new code. Observed on 19 November 2026 in a Remote Control session:

- `/mcp` printed a one-line status summary instead of the menu.
- `/mcp reconnect finna-libraries` answered "Reconnect, enable, and disable
  aren't available in this session." The Remote Control documentation says
  these subcommands need a session that runs in an interactive terminal:
  https://code.claude.com/docs/en/remote-control
- A new session started the server afresh and had the new tools.

So: start a new session.
