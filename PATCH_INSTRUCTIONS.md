# Productivity Feature Patch

This patch adds these features to the existing MedTracker app:

- Daily Today’s Plan dashboard
- Overdue lecture system
- Drag-and-drop lecture rescheduling in weekly view
- Exam-based study mode
- Progress bars by block, course, and exam
- Smart catch-up planner
- Priority labels
- Board resource checklist
- Weekly view
- Exam countdown cards
- Daily completion score
- Weekly report
- “What should I do next?” recommendation
- Practical exam checklist

## Files changed

Replace these files in your GitHub repository:

- `src/App.jsx`
- `src/csvImport.js`
- `src/styles.css`
- `public/lecture-template.csv`

No Firebase project recreation is required.

## CSV columns

Core columns:

```csv
date,startTime,endTime,course,title,instructor,source
```

Optional productivity columns:

```csv
exam,examDate,priority,lectureType,estimatedMinutes,boardResource,notesLink
```

Recommended full header:

```csv
date,startTime,endTime,course,title,instructor,source,exam,examDate,priority,lectureType,estimatedMinutes,boardResource,notesLink
```

Priority values:

- `high`
- `medium`
- `low`

Lecture type values:

- `lecture`
- `sdl`
- `lab`
- `practical`
- `exam`

## Deploy after updating files

After committing the changed files to GitHub, Netlify should auto-deploy. If it does not, go to:

Netlify → Deploys → Trigger deploy → Deploy site

## Firestore rules

For testing, your current signed-in-user rules will work. The new features store additional fields on each lecture and extra progress keys in the same existing `progress` documents.

Later, tighten the Firestore rules before sharing broadly with classmates.
