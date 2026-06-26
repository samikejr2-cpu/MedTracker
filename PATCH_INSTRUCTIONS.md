# MedTracker Focus + Customization Patch

This patch adds:

- Pomodoro focus timer
- Full-screen nature focus mode while the timer runs
- Optional uploaded focus background image
- Daily board-question tracker: planned questions, completed questions, source, notes
- Right-side Settings menu
- Custom homepage section visibility and order
- Full app color customization

## How to apply through GitHub

1. Extract this ZIP.
2. Open the extracted folder named `medtracker_focus_changed_files`.
3. Go to your GitHub repo.
4. Click **Add file → Upload files**.
5. Drag these items into GitHub:
   - `src`
   - `firestore.rules`
   - `PATCH_INSTRUCTIONS.md`
6. GitHub should say it is replacing `src/App.jsx` and `src/styles.css`.
7. Click **Commit changes**.
8. Go to Netlify → Deploys.
9. Click **Trigger deploy → Clear cache and deploy site**.
10. Wait until the deploy says **Published**.
11. Open your app and hard refresh.

## If you use stricter Firestore rules

Copy the included `firestore.rules` into Firebase:

Firebase → Firestore Database → Rules → paste → Publish

If you are still using the broad testing rule that allows any signed-in user to read/write, this step is optional.

## How to confirm the patch is live

In the live app, you should see a floating right-side menu with:

- Settings
- Today
- Import

The dashboard should include:

- Pomodoro study session
- Daily board-question goal

Starting the Pomodoro timer should open a full-screen nature background with the timer on top.
