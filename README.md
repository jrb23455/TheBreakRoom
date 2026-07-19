# TheBreakRoom

A real, permanently-hosted version of TheBreakRoom, backed by a Supabase database
instead of Claude's artifact-only storage.

## Files (all sit at the top level on purpose — no subfolders)

- `App.jsx` — the app itself.
- `storage.js` — replaces `window.storage` with real Supabase calls, and adds
  `window.breakroomAuth` for shared login (see below).
- `main.jsx` — loads `storage.js`, then renders `App.jsx`.
- `index.html` — entry point. The favicon is embedded directly in this file
  (as a data URI) so there's no separate image file to lose track of.
- Everything else is standard Vite + React scaffolding.

There are no subfolders anywhere in this project, on purpose — that way there's
nothing for a drag-and-drop upload to accidentally flatten or misplace.

## Shared login across your apps

TheBreakRoom's phone + PIN login is no longer its own separate account list —
it calls the same `branch_login` function and `students` table that ProSim and
RepLine already use. Sign up or sign in once with a phone + PIN, and that same
login works in every app connected to this system. The Mailroom's "who can I
message" directory is the same shared list too (via `breakroom_list_people`),
so it shows everyone across every connected app, not just people who've opened
TheBreakRoom specifically.

Two small database additions were made to support this (both non-destructive,
neither touches any existing ProSim/RepLine data):
- `breakroom_kv_store` — TheBreakRoom's own chat/board/DM/presence data.
- `breakroom_list_people()` — a read-only function exposing just id + name
  (never phone or PIN) for the Mailroom directory.

## Uploading to GitHub

**If you already have a repo with files in it from a previous attempt:**
delete every file currently in it first (select them all, delete, commit),
then upload these fresh — don't mix the two.

To upload: open your repo on github.com → **Add file → Upload files** → drag in
every file from this folder (all of them, all at once) → commit.

## Deploying on Vercel

1. In your Vercel project, go to **Settings → General → Root Directory** and
   make sure it's **blank** (not `site` — these files sit at the true repo root now).
2. Go to **Deployments** and trigger a redeploy (or just push a new commit).
3. You should get a real URL like `thebreakroom.vercel.app`.

Every future push to GitHub rebuilds and updates the live site automatically.

## About the database

This connects to a Supabase project (already set up) using its public "anon" key,
which is safe to ship in client-side code — it only allows what the database's
Row Level Security policies permit. Right now that policy allows anyone with the
key to read/write, matching the app's original design: this is a workplace
convenience tool with a phone+PIN gate, not a bank-grade security model. If that
ever needs to change, it happens on the Supabase side, not in this code.

## Local development

```
npm install
npm run dev
```
