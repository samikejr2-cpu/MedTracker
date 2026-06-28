# MedTracker Study Time Log Patch

This patch adds the Study Time Log feature and corrects the Board checklist labels.

## Updates

1. Board checklist labels now show:
   - Board Video/Resource
   - Question Bank Set?

2. New Study Time Log feature:
   - Integrated timer with Start / Pause / Reset
   - Quick-add buttons for +15, +30, +60 minutes
   - Subject / lecture text field
   - Notes text field
   - Date selector and calendar date picker
   - Saves study sessions to Firebase
   - Shows selected-day total, weekly total, and all-time total
   - Shows saved study sessions for the selected date
   - Allows deleting saved study sessions

## Install

1. Upload these files/folders into the root of your GitHub repo:
   - src
   - firestore.rules
   - PATCH_INSTRUCTIONS.md

2. Commit changes.

3. In Firebase, publish the included firestore.rules if you are using stricter rules.

4. In Netlify, redeploy using:
   - Deploys → Trigger deploy → Clear cache and deploy site

5. Open https://medltracker.netlify.app and hard refresh.

## Netlify reminder

If Netlify secret scanning fails, make sure these environment variables exist:

SECRETS_SCAN_OMIT_KEYS=VITE_FIREBASE_API_KEY,VITE_FIREBASE_AUTH_DOMAIN,VITE_FIREBASE_PROJECT_ID,VITE_FIREBASE_STORAGE_BUCKET,VITE_FIREBASE_MESSAGING_SENDER_ID,VITE_FIREBASE_APP_ID
SECRETS_SCAN_OMIT_PATHS=node_modules/**
SECRETS_SCAN_SMART_DETECTION_ENABLED=false
SECRETS_SCAN_ENABLED=false
