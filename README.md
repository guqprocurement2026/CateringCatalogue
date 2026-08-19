# GU-Q Catering Catalogue — GitHub + Google Sheets

This production package is designed so the **live catalogue does not store hotel photos or menu attachments inside GitHub**.

After the one-time connection between GitHub Pages and Google Apps Script:

- hotel card images come from `Suppliers!image_url`
- menu/attachment links come from `Hotel Categories!menu_url`
- prices come from the Google Sheet
- category averages are formula-driven
- supplier status/tier comes from the Google Sheet
- page wording and selected design settings come from `Site Settings`

## Important

If `image_url` is blank, the site displays an elegant placeholder asking for the Sheet image link.

If `menu_url` is blank, the relevant category displays `LINK NEEDED`.

The production package intentionally contains no hotel photo fallback library and no menu PDF fallback library. This prevents old files in GitHub from silently overriding or substituting for what Procurement has entered in Google Sheets.

## Package structure

```text
/
├── index.html
├── config.js
├── .nojekyll
├── assets/
│   ├── css/styles.css
│   ├── js/app.js
│   ├── images/.gitkeep
│   └── menus/.gitkeep
├── google-apps-script/
│   └── Code.gs
├── google-sheet/
│   └── Catering_Catalogue_Google_Sheet_SHEET_LINKS.xlsx
├── docs/
└── README.md
```

## One-time GitHub edit

In `config.js`, paste the deployed Apps Script `/exec` URL into `SHEET_API_URL`.

After that, normal catalogue maintenance happens in Google Sheets.

Start with `docs/00_QUICK_START.md`.
