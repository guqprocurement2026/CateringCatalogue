GU-Q PREFERRED CATERING VENUES — SIMPLE EXCEL-DRIVEN PACKAGE
============================================================

THE ONLY CATALOGUE EDITING FILE IS:
  Catering_Catalogue.xlsx

It has exactly two tabs:
  1. Menus
  2. Hotels

HOW THE CATALOGUE WORKS
-----------------------
HOTELS tab
- One row = one hotel card.
- Add a hotel here to create a hotel card.
- Set Active to FALSE to hide a hotel.

MENUS tab
- One row = one category shown inside a hotel card.
- Categories can be Coffee Break, Breakfast, Buffet, Canapés, Set Menu,
  Meeting Package, Beverage, Meeting Spaces, or any new category you type.
- Meeting Spaces is intentionally handled exactly like the other categories.
- Average Price QAR can be blank for Meeting Spaces or non-priced attachments.
- Attachment Link accepts:
    • Google Drive links
    • Box links
    • SharePoint/OneDrive links
    • normal web links
    • PDF filenames stored in this GitHub folder
- Set Active to FALSE to hide one row/category.

ADDING A NEW MENU
-----------------
1. Open Menus.
2. Add a new row or find the existing hotel/category row.
3. Paste the attachment URL in Attachment Link.
4. Enter/update Average Price QAR if needed.
5. Done. The live website reads the Sheet automatically.

ADDING / CHANGING MEETING SPACES
--------------------------------
Use the Menus tab.
Example:
  Hotel: Four Seasons Hotel Doha
  Category: Meeting Spaces
  Average Price QAR: [leave blank]
  Attachment Link: https://...your Drive/Box/venue link...
  Active: TRUE

ADDING A NEW HOTEL
------------------
1. Add the hotel in Hotels.
2. Add its menu/category rows in Menus.
3. The website creates the card automatically.

ONE-TIME GOOGLE SHEET CONNECTION
--------------------------------
1. Upload Catering_Catalogue.xlsx to Google Drive and open it as Google Sheets.
2. In Google Sheets: Extensions → Apps Script.
3. Paste all code from google_sheet_api.gs and save.
4. Deploy → New deployment → Web app.
5. Execute as: Me.
6. Set access as appropriate for your GU-Q use case.
7. Copy the deployed URL ending in /exec.
8. Open google_sheet_connection.js once and paste that URL into APPS_SCRIPT_URL.
9. Upload the website files to GitHub Pages.

After Step 8, ROUTINE CATALOGUE EDITS ARE 100% IN THE GOOGLE SHEET.
You do not edit index.html, website_app.js, or GitHub files when adding menus,
links, prices, categories, meeting spaces, or hotels.

WHY THIS CONNECTION IS MORE RELIABLE
------------------------------------
The website uses JSONP when reading Apps Script. This avoids the common browser
CORS problem that can occur when GitHub Pages tries to fetch Apps Script JSON.
If the live Sheet is not connected during local preview, preview_data.json is
used so the design can still be opened.

FILES TO UPLOAD TO GITHUB
-------------------------
  index.html
  website_styles.css
  website_app.js
  google_sheet_connection.js
  preview_data.json
  current menu PDFs (only if you want the packaged PDFs to keep working)

FINANCE / GOOGLE SHEET FILES — DO NOT NEED TO BE PUBLIC ON GITHUB
-----------------------------------------------------------------
  Catering_Catalogue.xlsx
  google_sheet_api.gs
  README_FIRST.txt
