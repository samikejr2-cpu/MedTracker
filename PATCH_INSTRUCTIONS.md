# Dr. Stephens Boards Tracker Patch

This patch reworks the Daily Question Goal feature into **Dr. Stephens Boards Tracker**.

## Features included

- Renames the dashboard feature to **Dr. Stephens Boards Tracker**
- Adds a tracker date selector using both:
  - a dropdown
  - a calendar/date picker
- Adds fields for:
  - Planned questions
  - Completed questions
  - Number of questions correct
  - Question source as free text
  - Notes
- Adds edit support after saving the tracker
- Adds clear/reset for an individual date
- Adds daily progress, accuracy, remaining questions, and weekly summary
- Keeps the tracker synced through Firebase/Firestore

## Files changed

Upload these files/folders into the root of your GitHub repo:

- `src/App.jsx`
- `src/styles.css`
- `firestore.rules`
- `PATCH_INSTRUCTIONS.md`

## Install steps

1. Go to GitHub repo: `samikejr2-cpu/MedTracker`
2. Click **Add file → Upload files**
3. Upload the contents of this patch folder, not the outer ZIP folder.
4. Click **Commit changes**
5. Go to Netlify → Deploys
6. Click **Trigger deploy → Clear cache and deploy site**
7. Wait for **Published**
8. Open `https://medltracker.netlify.app`
9. Hard refresh on PC with `Ctrl + Shift + R`

## Firebase rules

If your app currently works with broad testing rules, this patch will still work.

If you use the stricter included rules, copy `firestore.rules` into:

Firebase → Firestore Database → Rules → Publish
