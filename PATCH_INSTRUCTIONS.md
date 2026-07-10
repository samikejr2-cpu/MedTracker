# MedTracker Daily Study Tracker Patch

This patch updates the prior MedTracker build with the requested Daily Study Tracker workflow and Study Time Log improvements.

## What changed

- Renamed the `Selected Day` feature to `Daily Study Tracker`.
- Daily Study Tracker now keeps Core checklist completion separate for the day score.
- Lecture/lab cards include a checklist editor that lets you:
  - add custom checklist items with a text box,
  - hide built-in items you do not need,
  - delete custom checklist items,
  - schedule each checklist item on its own date.
- Individual checklist items now have a drag handle (`⇅`) so you can drag a single task to another day without moving the whole lecture/lab.
- A weekly drop zone was added at the top of Daily Study Tracker. Drop a task onto a date to reschedule that task.
- Dragged checklist items stay linked to the original lecture/lab title so the task remains clear after moving.
- The homepage feature cards can be dragged and dropped to customize their order.
- Study Time Log now has an exact-minutes text field for manual time entry while keeping quick-add time buttons, including +15, +30, and +60 minutes.

## Files to upload to GitHub

Upload these items from this extracted folder into the root of the GitHub repository:

- `src`
- `PATCH_INSTRUCTIONS.md`

If your GitHub repo currently keeps `App.jsx` and `styles.css` in the root, upload those two root files too. They are included here as synced copies.

## Deploy

After committing the files in GitHub, go to Netlify:

Deploys → Trigger deploy → Clear cache and deploy site

Wait for Published, then hard refresh the app on PC and iPad.

## Notes

- No new Firestore collections were added.
- The task scheduling data is saved on each lecture/lab document under `taskDates`, so your existing Firestore rules should continue to work if they already allow lecture updates.
- Built-in checklist items are hidden instead of permanently deleted so they can be restored later. Custom checklist items are deleted when removed.
