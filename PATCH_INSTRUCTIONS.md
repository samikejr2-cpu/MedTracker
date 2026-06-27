# MedTracker One-Feature Homepage Patch

This patch redesigns the dashboard so the app opens to a clean homepage with an introduction and feature cards. Each feature opens one at a time instead of showing every dashboard section on one long page.

## Features

- Simple homepage / introduction screen
- Feature cards for:
  - Today's Plan
  - Focus Timer
  - Dr. Stephens Boards Tracker
  - Exam Countdown + Readiness
  - Overdue Lectures
  - Smart Catch-Up Planner
  - Progress Bars
  - Weekly View
  - Weekly Report
  - Selected Day Lectures
  - All Saved Lectures
  - Import / Add Lectures
- "← Homepage" button on every feature view
- Right-side menu still includes Settings, Today, and Import
- Settings still controls which homepage cards appear and the order of those cards
- Build-tested successfully

## Install

1. Extract this ZIP.
2. Open your GitHub repository.
3. Click **Add file → Upload files**.
4. Upload the `src` folder and this `PATCH_INSTRUCTIONS.md` file from inside the extracted folder.
5. Commit changes.
6. In Netlify, run **Deploys → Trigger deploy → Clear cache and deploy site**.
7. After Netlify says **Published**, open `https://medltracker.netlify.app` and hard refresh.

## Notes

If Netlify secrets scanning fails, keep these environment variables in Netlify:

- `SECRETS_SCAN_OMIT_KEYS` = `VITE_FIREBASE_API_KEY,VITE_FIREBASE_AUTH_DOMAIN,VITE_FIREBASE_PROJECT_ID,VITE_FIREBASE_STORAGE_BUCKET,VITE_FIREBASE_MESSAGING_SENDER_ID,VITE_FIREBASE_APP_ID`
- `SECRETS_SCAN_OMIT_PATHS` = `node_modules/**`
- `SECRETS_SCAN_ENABLED` = `false`

This patch does not change Firebase collections or Firestore rules.
