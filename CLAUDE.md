# Woodland Site Accounts - rules for future sessions

Google Apps Script web app (V8). One shared cash book for Woodland Architects. Data lives in a Google Sheet and a Drive folder in the owner's account.

## Layout
- `src/Code.gs` server. `src/index.html` the whole app. `src/appsscript.json` manifest (Asia/Kolkata, ANYONE_ANONYMOUS, USER_DEPLOYING).
- `test/` local harness (`npm test`). Never deploy without it passing.

## Hard rules
- Never write `/*` anywhere in index.html except in a real comment (Google's HtmlService deletes from `/*` to the next `*/`). Use `accept="image/jpeg,image/png,image/webp,image/heic"`. Prefer `//` comments in JS, none in CSS. `test/checks.js` fails the build on this.
- No alert()/confirm()/prompt(); use askConfirm(). No external JS libraries; Google Fonts is the only external resource.
- No business data in the code; the app starts empty. PINs live only in Script Properties (TEAM_PIN, ADMIN_PIN), never in HTML or Git.
- Every server write is under LockService; never call a function that takes the lock while already holding it (ctx_() must be called before lock_()).
- Server enforces everything: staff may edit/delete only their own unchecked entries; only admin checks, restores, removes list items, edits sites. Deletes are soft. Every row is sealed (SHA-256 with a secret key) so `auditLedger` detects hand edits in the Sheet.
- Client: offline outbox in localStorage; entries carry a clientRef so retries never duplicate. Deterministic refusals (forbidden, locked, invalid...) drop at once; unknown errors retry 3 times, then once without photo, then drop with a visible message.
- Public functions in Code.gs (no trailing underscore) are callable from the page. Keep helpers ending in `_`.
- Don't edit source files through PowerShell Get-Content/Set-Content (it corrupts non-ASCII).

## Deploy
- `clasp push`, then update the SAME deployment so the WhatsApp link never changes: `clasp deploy -i <DEPLOYMENT_ID> --description "vN"`.
- Deployment ID: AKfycbx-ATLkJIq4gtmN2cMwa8MP8VrTaR9VAiPO5tTA0mg5zNKj7S0fpDiLto1_WBv-cH9yjA (v1)
- Link: https://script.google.com/macros/s/AKfycbx-ATLkJIq4gtmN2cMwa8MP8VrTaR9VAiPO5tTA0mg5zNKj7S0fpDiLto1_WBv-cH9yjA/exec
- Script ID is in `.clasp.json`. Script editor: https://script.google.com/d/1TdPbwHo8IR3vroY8s6aUVkbNsYFUIkAMPeaDlMvhzqziLkLq9_55_s-z/edit
- Never run `clasp create` again: it overwrites src/appsscript.json with a default manifest.
- Use `clasp` by its full name in PowerShell here; the Terminal panel tab does not have it on PATH.
- First-time owner steps: run `setPins()` once from the Apps Script editor after typing the two PINs inside it, then undo the typing.

## Link to Project OS
- Sites carry a `projectId` (WA-###) in an extra last column of the Sites tab ('Project OS ID'; the header is added automatically to old sheets).
- Admin button 'Bring in projects from Project OS' (Sites tab) calls `syncProjects`: asks Project OS for in-process projects, shows what will be added or linked, then writes. Existing sites with the same name are linked, never renamed or duplicated; nothing is deleted.
- Needs Script Property `LINK_KEY` (a copy of Project OS's). `PROJECT_OS_URL` is optional (default is in Code.gs). The manifest has the extra scope `script.external_request`: after the first deploy the owner must open the script editor, run `doGet` once and accept the new permission (do NOT run `setPins` for this).
