# Med School Lecture Tracker — StackBlitz Version

Dark-mode medical school lecture tracker built with React, Vite, Firebase Authentication, and Cloud Firestore.

## Features

- Login with username/email/password through Firebase Authentication
- Shared workspaces/blocks using join codes
- Syncs across PC, iPad, iPhone, and other devices through Firestore
- CSV import for block calendars
- Manual lecture entry
- Daily lecture dashboard
- Edit lectures after import
- Move lectures to different days if you did not finish them on the original date
- Progress checkboxes for:
  - Watched lecture
  - Took notes
  - Made Anki
  - First pass
  - Second pass
- Delete old workspaces if you own them
- Leave workspaces you joined

## CSV format

Use this exact header row:

```csv
date,startTime,endTime,course,title,instructor,source
```

Example:

```csv
date,startTime,endTime,course,title,instructor,source
2026-07-06,08:30,09:30,PATHOLOGY,"Histology of the Esophagus, Stomach and Intestines",Dr. D. Cawley,Block 5
2026-07-06,09:30,10:30,ANATOMY,"Pre-Lab 1 Lecture: Abdomen and Anterior Abdominal Wall",Dr. M. Piscura,Block 5
```

Required columns:

- `date`
- `title`

Optional columns:

- `startTime`
- `endTime`
- `course`
- `instructor`
- `source`

## Firebase environment variables

Create a `.env` file or set these in your hosting/editor environment:

```txt
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

The values come from:

Firebase Console → Project settings → General → Your apps → Web app → SDK setup and configuration → Config

## Local/StackBlitz commands

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Netlify deployment settings

If deploying on Netlify:

- Build command: `npm run build`
- Publish directory: `dist`

`netlify.toml` is already included.
