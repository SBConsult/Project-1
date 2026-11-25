# Steven Belin photography

The website is built from the Google Drive folder **images** and published to GitHub Pages every hour.

## Adding and removing photos

Everything is done in Google Drive. No code.

| To do this | Do this in Drive |
|---|---|
| Add a photo | Drop it into a gallery folder, for example `01 Street` |
| Remove a photo | Move it out of the gallery folder (or delete it) |
| Add a gallery | Create a new folder in **images**, for example `06 Night` |
| Add a travel gallery | Create a folder inside `05 Travels`, for example `Rome` |
| Change the gallery order | Change the number at the start of the folder name |
| Hide a gallery | Start its folder name with `_`, for example `_Drafts` |
| Write a gallery introduction | Put a Google Doc (or a .txt file) with a few sentences in the gallery folder |

- Photos left loose in **images** are not published, so the top level works as an inbox
- Photos in a gallery appear in filename order. The first one is the gallery's cover
- Photos are never edited. The site makes resized web copies only
- Changes appear on the site within the hour. To publish straight away: GitHub → Actions → Publish site → Run workflow

## Site text

The name, statement, About text, contact details and the opening photograph are in `content/settings.json`.
Default gallery introductions are in `content/intros.json` (a Google Doc in the folder takes priority).

## How it works

- `src/drive.mjs` reads the Drive folder (shared "anyone with the link", no API key) and downloads new photos
- `src/build.mjs` makes the web copies and pages into `dist/`
- `.github/workflows/site.yml` runs both every hour and publishes to GitHub Pages
- The Drive folder ID is the repository variable `DRIVE_FOLDER_ID`, not stored in the code

Local preview: `npm ci`, put photos in `originals/`, then `npm run preview`.
