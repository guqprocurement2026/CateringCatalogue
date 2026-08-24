/**
 * GU-Q Preferred Catering Venues — Google Sheet API
 *
 * Workbook must contain exactly these tabs:
 *   1) Menus
 *   2) Hotels
 *
 * Routine catalogue edits happen only in those two tabs.
 */

function doGet(e) {
  const payload = {
    hotels: sheetToObjects_('Hotels'),
    menus: sheetToObjects_('Menus'),
    generated_at: new Date().toISOString()
  };

  const json = JSON.stringify(payload);
  const callback = e && e.parameter ? String(e.parameter.callback || '') : '';

  // JSONP support avoids browser CORS problems on GitHub Pages.
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetToObjects_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing required sheet: ' + sheetName);

  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(v => String(v || '').trim());
  return values.slice(1)
    .filter(row => row.some(v => String(v || '').trim() !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}
