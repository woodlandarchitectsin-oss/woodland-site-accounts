# Tests

Run everything with one command from the project folder:

    npm test

This runs, in order:
1. `test/checks.js` - node --check on Code.gs and the page scripts; simulates Google stripping `/* ... */` and fails if anything would change; enforces the hard rules (no alert/confirm/prompt, no external scripts, no PINs in the page, fonts, manifest).
2. `test/scenarios.js` - the real index.html in jsdom on two or more "phones" against mocked SpreadsheetApp/DriveApp/PropertiesService/LockService/Utilities/Session (Code.gs loaded with `vm`). Covers sync between phones, offline photo upload, petty-cash maths, permission refusals, same-site race, wrong PIN, lost replies, photo failures, full storage, timeouts, reopening offline, edit history, audit.
3. `test/shots.js` - Chromium (Playwright) at 390 px and 1280 px, light and dark; checks no horizontal overflow, 44 px touch targets, no browser errors; screenshots go to `test/shots/`.

First time only: `npm install` then `npx playwright install chromium`.
`npm run test:fast` skips the browser step. Run one scenario: `node test/scenarios.js "petty cash"`.
