# MedTracker Homepage Tabs Patch

This patch reorganizes the app into a cleaner homepage with feature tabs.

## What changed

- Adds a simple Home screen.
- Adds feature tabs so only one tool opens at a time.
- Tabs include:
  - Home
  - Today's Plan
  - Focus Timer
  - Dr. Stephens Boards Tracker
  - Progress Bars
  - Weekly View
  - Weekly Report
  - Selected Day
  - All Saved Lectures
- Keeps Import/Add Lectures available from the right-side quick menu.
- Keeps the right-side Settings button.
- Settings now controls which feature tabs appear and their order.
- All Saved Lectures now opens as its own full library page instead of only appearing when a day has no lectures.

## Files to upload to GitHub

Upload the contents of this patch folder to your GitHub repo root:

- src/App.jsx
- src/styles.css
- PATCH_INSTRUCTIONS.md

GitHub should show that `src/App.jsx` and `src/styles.css` are being replaced.

## Deploy

After committing in GitHub, go to Netlify and run:

Deploys -> Trigger deploy -> Clear cache and deploy site

Then open your site and hard refresh:

- PC: Ctrl + Shift + R
- iPad: close Safari completely and reopen the app link
