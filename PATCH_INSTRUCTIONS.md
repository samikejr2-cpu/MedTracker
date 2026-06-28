# Andrew Credit + Three-Pass Checklist + Mobile Polish Patch

This patch updates the current MedTracker app with:

1. A login-page credit: **Created by Andrew Mike.**
2. A simplified core lecture checklist:
   - **1. First Pass (watched lecture)**
   - **2. Second Pass (Took Notes / Make Anki)**
   - **3. Third Pass (Reviewed Anki / Notes)**
3. Backward compatibility with older saved lecture progress keys where possible.
4. Improved iPhone/iPad/mobile layout and touch usability.

## Install

Upload these items to the root of your GitHub repository:

- `src`
- `index.html`
- `PATCH_INSTRUCTIONS.md`

Then commit changes and deploy in Netlify with:

**Deploys → Trigger deploy → Clear cache and deploy site**

After deployment, hard refresh:

- PC: `Ctrl + Shift + R`
- iPad/iPhone: close Safari fully and reopen the app
