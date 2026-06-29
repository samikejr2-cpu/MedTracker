# MedTracker Patch: Adaptive Analytics + Boards Checklist + General To-Do List

This patch keeps the adaptive estimator and analytics features and adds:

1. Exam Planner
2. Course Breakdown
3. Study Time by Subject
4. Smart Study Time Estimator
5. Boards Checklist from `Boards Blank Copy.xlsx`
6. General To-Do List

## Files included in the changed-files patch

Upload these to the root of the GitHub repo:

- `src/`
- `firestore.rules`
- `PATCH_INSTRUCTIONS.md`

## New Boards Checklist feature

Adds a homepage feature titled **Boards Checklist**.

It includes resource buttons for:

- Boards and Beyond
- Sketchy Micro
- Sketchy Pharm
- Sketchy Path
- First Aid
- Pathoma
- Pixorize
- Physeo
- Goljan
- FA

Each resource has:

- Full checklist rows extracted from the uploaded workbook
- Checkbox per row
- Editable free-text notes per row
- Percent completed
- Percent of video/audio time completed when duration data exists
- Total watched time and total listed time
- Search inside each resource

## New General To-Do List feature

Adds a homepage feature titled **General To-Do List**.

It includes:

- Free-text task entry
- Checkbox completion
- Edit task
- Delete task
- Move task up/down
- Completion statistics

## Firestore rules

This patch adds two workspace subcollections:

- `boardsChecklist`
- `todoItems`

If your current Firebase rules are strict, publish the included `firestore.rules` file in Firebase:

Firebase Console → Firestore Database → Rules → paste contents → Publish

## Netlify deploy

After uploading to GitHub:

Netlify → Deploys → Trigger deploy → Clear cache and deploy site

Keep your existing Netlify secrets-scan variables if they were needed previously.
