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

## Login — now fully centralized

TheBreakRoom has no login form of its own anymore. On load, it checks
`https://auth.topclosers.wtf/api/session` (with credentials/cookies
included). If that comes back logged-in, it uses that identity. If not, it
redirects straight to `https://topclosers.wtf/?return=<this page>` — the
one central login for every app in this family.

This replaced two earlier approaches, in order:
1. TheBreakRoom's own phone+PIN form calling `branch_login` directly.
2. A handoff-token bridge (`?handoff=TOKEN` in the URL) for landing here
   already logged in from another app, before real shared cookies worked
   across subdomains.

Both are gone now that `breakroom.topclosers.wtf` shares a real parent
domain with the auth service and the rest of the app family, so a real
browser session cookie does the whole job.

One assumption worth flagging: the sign-out button calls
`POST https://auth.topclosers.wtf/api/logout`. That exact path wasn't
handed to me explicitly — if the real logout endpoint differs, sign-out
will silently fail to clear the shared session even though the button
still redirects. Worth a quick manual check.

## Shared login across your apps (background)

TheBreakRoom's Mailroom directory (`breakroom_list_people`) and presence
still use the same shared `students` table as everything else — that part
is unchanged. Only the *login flow itself* moved to the central service.

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
