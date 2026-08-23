/**
 * GU-Q Preferred Catering Venues
 * Finance backend + Events attachment upload portal
 *
 * Architecture:
 * - Finance controls this Google Sheet, GitHub token, prices, and access.
 * - Events receive only the deployed Apps Script web-app URL.
 * - New PDFs are archived in Finance Google Drive AND published into the
 *   GitHub repository root, so the website uses reliable same-origin links.
 * - The website never fetches Google Sheets directly.
 */

const SHEETS = {
  MENUS: 'MENUS',
  HOTELS: 'HOTELS',
  ACCESS: 'ACCESS',
  CONFIG: 'CONFIG',
  LOG: 'UPLOAD LOG'
};

const GITHUB_BRANCH = 'main';
const GITHUB_DATA_FILE = 'catalogue.json';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Catering Catalogue')
    .addItem('1. Run backend setup', 'setupBackend')
    .addItem('2. Save GitHub token', 'setGitHubToken')
    .addItem('3. TEST GitHub connection', 'testGitHubConnection')
    .addItem('4. PUBLISH catalogue now', 'publishCatalogueNow')
    .addSeparator()
    .addItem('5. Show Events upload portal URL', 'showUploadPortalUrl')
    .addItem('6. Verify complete setup', 'verifySetup')
    .addToUi();
}

function setupBackend() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the Finance control Google Sheet and run setup from its Catering Catalogue menu.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  const required = Object.values(SHEETS);
  const missing = required.filter(n => !ss.getSheetByName(n));
  if (missing.length) {
    throw new Error('Missing required sheet(s): ' + missing.join(', '));
  }

  ensureHeaders_();

  let rootId = getConfig_('DRIVE_ROOT_FOLDER_ID');
  let folder = null;
  if (rootId) {
    try { folder = DriveApp.getFolderById(rootId); } catch (e) {}
  }
  if (!folder) {
    folder = DriveApp.createFolder('GU-Q Catering Catalogue Upload Archive');
    setConfig_('DRIVE_ROOT_FOLDER_ID', folder.getId());
  }

  const me = activeUserEmail_();
  if (me) ensureAccessRow_(me, 'Finance Admin');

  const webUrl = ScriptApp.getService().getUrl();
  if (webUrl) setConfig_('UPLOAD_PORTAL_URL', webUrl);

  SpreadsheetApp.getUi().alert(
    'Backend setup complete.\n\n' +
    'Drive archive: ' + folder.getName() + '\n' +
    (webUrl ? 'Upload portal: ' + webUrl + '\n' : '') +
    '\nNext: fill GITHUB_OWNER and GITHUB_REPO in CONFIG, then save the GitHub token.'
  );
}

function setGitHubToken() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    'Save GitHub token',
    'Paste a fine-grained GitHub token that has Contents: Read and write access ONLY to this catalogue repository.',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const token = String(result.getResponseText() || '').trim();
  if (!token) throw new Error('No token was entered.');
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', token);
  ui.alert('GitHub token saved securely in Apps Script Properties. It is not stored in the workbook.');
}

function testGitHubConnection() {
  const cfg = githubConfig_();
  const url = 'https://api.github.com/repos/' +
    encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: githubHeaders_(cfg.token),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error(
      'GitHub connection failed (HTTP ' + status + ').\n\n' +
      response.getContentText().slice(0, 800)
    );
  }

  const body = JSON.parse(response.getContentText());
  SpreadsheetApp.getUi().alert(
    '✓ GitHub connection working\n\n' +
    'Repository: ' + body.full_name + '\n' +
    'Branch used by this system: ' + GITHUB_BRANCH + '\n' +
    'Catalogue data file: ' + GITHUB_DATA_FILE
  );
}

function publishCatalogueNow() {
  const result = publishCatalogue_('Finance manual catalogue publish');
  SpreadsheetApp.getUi().alert(
    '✓ Catalogue published to GitHub.\n\nCommit:\n' + (result.commitUrl || 'Completed')
  );
}

function verifySetup() {
  const issues = [];
  ['GITHUB_OWNER', 'GITHUB_REPO'].forEach(k => {
    if (!getConfig_(k)) issues.push('CONFIG → ' + k + ' is blank.');
  });
  if (!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN')) {
    issues.push('GitHub token has not been saved.');
  }
  if (!getConfig_('DRIVE_ROOT_FOLDER_ID')) issues.push('Drive archive folder is not configured.');

  const portal = ScriptApp.getService().getUrl() || getConfig_('UPLOAD_PORTAL_URL');
  if (!portal) {
    issues.push('Apps Script has not yet been deployed as a Web app, so Events does not have an upload portal URL.');
  }

  const accessRows = rows_(SHEETS.ACCESS);
  const uploaders = accessRows.filter(r =>
    bool_(r.Active) &&
    String(r.Email || '').trim() &&
    ['Events Uploader', 'Finance Admin'].includes(String(r.Role || '').trim())
  );
  if (!uploaders.length) issues.push('ACCESS has no active Events Uploader / Finance Admin email.');

  SpreadsheetApp.getUi().alert(
    issues.length
      ? 'Setup still needs attention:\n\n• ' + issues.join('\n• ')
      : '✓ Setup looks complete.\n\nEvents can use the upload portal without GitHub, spreadsheet, or website-code access.'
  );
}

function showUploadPortalUrl() {
  const url = ScriptApp.getService().getUrl() || getConfig_('UPLOAD_PORTAL_URL');
  if (!url) {
    SpreadsheetApp.getUi().alert(
      'The upload portal does not have a URL yet.\n\n' +
      'In Apps Script choose Deploy → New deployment → Web app.\n' +
      'Execute as: you (Finance).\n' +
      'Access: restrict to your Georgetown organization/domain where available.\n' +
      'After deployment, run backend setup again.'
    );
    return;
  }
  setConfig_('UPLOAD_PORTAL_URL', url);
  SpreadsheetApp.getUi().alert('Events upload portal:\n\n' + url);
}

/* ------------------------------------------------------------------ */
/* EVENTS WEB APP                                                     */
/* ------------------------------------------------------------------ */

function doGet() {
  return HtmlService.createHtmlOutput(uploadPortalHtml_())
    .setTitle('GU-Q Catering Attachment Upload');
}

function getUploaderOptions() {
  const email = activeUserEmail_();
  const hotels = rows_(SHEETS.HOTELS)
    .filter(r => bool_(r.Active))
    .map(r => String(r.Hotel || '').trim())
    .filter(Boolean);

  const categories = [...new Set(
    rows_(SHEETS.MENUS)
      .filter(r => bool_(r.Active))
      .map(r => String(r.Category || '').trim())
      .filter(Boolean)
  )].sort();

  return {
    hotels,
    categories,
    activeEmail: email,
    activeEmailAuthorized: email ? isAuthorized_(email) : false,
    maxUploadMb: Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)
  };
}

/**
 * Receives a submitted HTML <form> as the sole google.script.run parameter.
 * The "attachment" field arrives as a Blob.
 */
function uploadAttachment(form) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const active = activeUserEmail_();
    const email = (active || String(form.uploader_email || '')).trim().toLowerCase();
    if (!email) throw new Error('Your email could not be identified. Enter your Georgetown email.');
    if (!isAuthorized_(email)) {
      throw new Error('This email is not authorized to publish catalogue attachments: ' + email);
    }

    const hotel = String(form.hotel || '').trim();
    const attachmentType = String(form.attachment_type || '').trim();
    const selectedCategory = String(form.category || '').trim();
    const newCategory = String(form.new_category || '').trim();
    const notes = String(form.notes || '').trim();
    const attachmentLabel = String(form.attachment_label || '').trim();

    if (!hotel) throw new Error('Choose a hotel / venue.');
    if (!hotelExists_(hotel)) throw new Error('The selected hotel is not active in HOTELS.');
    if (!['Catering Menu', 'Meeting Spaces', 'Hotel Attachment'].includes(attachmentType)) {
      throw new Error('Choose a valid attachment type.');
    }

    const blob = form.attachment;
    if (!blob || typeof blob.getBytes !== 'function') {
      throw new Error('Attach one PDF before submitting.');
    }

    const originalName = String(blob.getName() || 'attachment.pdf');
    const mime = String(blob.getContentType() || '').toLowerCase();
    if (mime !== 'application/pdf' && !originalName.toLowerCase().endsWith('.pdf')) {
      throw new Error('Only PDF files are accepted.');
    }

    const bytes = blob.getBytes();
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error('PDF is too large. Maximum allowed size is ' +
        Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024) + ' MB.');
    }

    let category = '';
    if (attachmentType === 'Catering Menu') {
      category = selectedCategory === '+ New category' ? newCategory : selectedCategory;
      if (!category) throw new Error('Choose or enter a catering category.');
    }

    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT', 'yyyyMMdd-HHmmss');
    const publishedName = 'upload-' +
      slug_(hotel) + '-' +
      slug_(attachmentType === 'Catering Menu' ? category : attachmentType) + '-' +
      stamp + '.pdf';

    const driveFile = archiveInDrive_(hotel, attachmentType, category, blob, originalName, stamp);

    let githubFileResult = null;
    let catalogueResult = null;
    let githubStatus = 'PENDING';

    try {
      githubFileResult = githubUpsertBytes_(
        publishedName,
        bytes,
        '[attachment] ' + hotel + ' — ' + (category || attachmentType)
      );

      if (attachmentType === 'Catering Menu') {
        upsertMenuRow_(hotel, category, publishedName, email, notes);
      } else if (attachmentType === 'Meeting Spaces') {
        updateHotelField_(hotel, 'Meeting Spaces Link', publishedName);
      } else {
        updateHotelField_(hotel, 'Hotel Attachment Link', publishedName);
        updateHotelField_(hotel, 'Attachment Label', attachmentLabel || 'Venue attachment');
      }

      markPreviousNotCurrent_(hotel, attachmentType, category);
      catalogueResult = publishCatalogue_(
        '[catalogue] Events attachment: ' + hotel + ' — ' + (category || attachmentType)
      );
      githubStatus = 'SYNCED';
    } catch (err) {
      githubStatus = 'FAILED — Finance action required';
      appendUploadLog_({
        hotel, attachmentType, category, originalName,
        driveFileId: driveFile.getId(),
        publishedLink: githubFileResult ? publishedName : '',
        current: false,
        uploadedBy: email,
        githubStatus,
        githubCommitUrl: githubFileResult ? githubFileResult.commitUrl : '',
        notes: (notes ? notes + ' | ' : '') + 'Error: ' + err.message
      });
      throw new Error(
        'The PDF was safely archived in Finance Drive, but website publishing failed. ' +
        'Finance can fix GitHub and run “PUBLISH catalogue now”.\n\n' + err.message
      );
    }

    appendUploadLog_({
      hotel, attachmentType, category, originalName,
      driveFileId: driveFile.getId(),
      publishedLink: publishedName,
      current: true,
      uploadedBy: email,
      githubStatus,
      githubCommitUrl: catalogueResult.commitUrl || githubFileResult.commitUrl || '',
      notes
    });

    return {
      ok: true,
      message: 'Attachment published successfully.',
      hotel,
      category,
      attachmentType,
      publishedLink: publishedName,
      commitUrl: catalogueResult.commitUrl || ''
    };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* SHEET DATA                                                         */
/* ------------------------------------------------------------------ */

function ensureHeaders_() {
  const expected = {
    'MENUS': ['Hotel','Category','Average Price QAR','Attachment Link','Active','Last Updated','Updated By','Notes'],
    'HOTELS': ['Hotel','Tier','Meeting Spaces Link','Hotel Attachment Link','Attachment Label','Active','Notes'],
    'ACCESS': ['Email','Role','Active'],
    'CONFIG': ['Key','Value','What to do'],
    'UPLOAD LOG': ['Upload ID','Hotel','Attachment Type','Category','File Name','Drive File ID','Published Link','Current','Uploaded At','Uploaded By','GitHub Status','GitHub Commit URL','Notes']
  };

  Object.keys(expected).forEach(name => {
    const sheet = ss_().getSheetByName(name);
    const actual = sheet.getRange(1, 1, 1, expected[name].length).getValues()[0];
    expected[name].forEach((h, i) => {
      if (String(actual[i] || '').trim() !== h) {
        throw new Error(name + ' header ' + (i + 1) + ' must be exactly "' + h + '".');
      }
    });
  });
}

function rows_(sheetName) {
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing sheet: ' + sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(v => String(v || '').trim());
  return values.slice(1).filter(row => row.some(v => v !== '' && v !== null)).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function buildCataloguePayload_() {
  const hotels = rows_(SHEETS.HOTELS).filter(r => bool_(r.Active));
  const menus = rows_(SHEETS.MENUS).filter(r => bool_(r.Active));

  const payloadHotels = hotels.map(h => {
    const hotelName = String(h.Hotel || '').trim();
    return {
      supplier: hotelName,
      tier: String(h.Tier || '').trim(),
      meeting_spaces_url: String(h['Meeting Spaces Link'] || '').trim(),
      meeting_spaces_note: String(h.Notes || '').trim(),
      hotel_attachment_url: String(h['Hotel Attachment Link'] || '').trim(),
      hotel_attachment_label: String(h['Attachment Label'] || '').trim(),
      categories: menus
        .filter(m => String(m.Hotel || '').trim() === hotelName)
        .map(m => ({
          category: String(m.Category || '').trim(),
          average_price_qar: normalizePrice_(m['Average Price QAR']),
          menu_url: String(m['Attachment Link'] || '').trim()
        }))
    };
  });

  const portalUrl = ScriptApp.getService().getUrl() || getConfig_('UPLOAD_PORTAL_URL');
  if (portalUrl && portalUrl !== getConfig_('UPLOAD_PORTAL_URL')) {
    setConfig_('UPLOAD_PORTAL_URL', portalUrl);
  }

  return {
    generated_at: new Date().toISOString(),
    settings: {
      events_upload_url: portalUrl || '',
      site_url: getConfig_('SITE_URL') || '',
      finance_support_email: getConfig_('FINANCE_SUPPORT_EMAIL') || ''
    },
    hotels: payloadHotels
  };
}

function publishCatalogue_(message) {
  const payload = buildCataloguePayload_();
  const result = githubUpsertText_(
    GITHUB_DATA_FILE,
    JSON.stringify(payload, null, 2),
    message || 'Update GU-Q catering catalogue'
  );
  setConfig_('LAST_GITHUB_SYNC_AT', new Date().toISOString());
  return result;
}

function upsertMenuRow_(hotel, category, link, email, notes) {
  const sheet = ss_().getSheetByName(SHEETS.MENUS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(v => String(v || '').trim());
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  let targetRow = -1;
  for (let r = 1; r < values.length; r++) {
    if (
      String(values[r][idx.Hotel] || '').trim() === hotel &&
      String(values[r][idx.Category] || '').trim() === category
    ) {
      targetRow = r + 1;
      break;
    }
  }

  if (targetRow < 0) {
    sheet.appendRow([hotel, category, '', link, true, new Date(), email, notes]);
    targetRow = sheet.getLastRow();
  } else {
    sheet.getRange(targetRow, idx['Attachment Link'] + 1).setValue(link);
    sheet.getRange(targetRow, idx.Active + 1).setValue(true);
    sheet.getRange(targetRow, idx['Last Updated'] + 1).setValue(new Date());
    sheet.getRange(targetRow, idx['Updated By'] + 1).setValue(email);
    if (notes) sheet.getRange(targetRow, idx.Notes + 1).setValue(notes);
  }

  // Refresh the upload portal category choices automatically because they are read live.
}

function updateHotelField_(hotel, header, value) {
  const sheet = ss_().getSheetByName(SHEETS.HOTELS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(v => String(v || '').trim());
  const hotelCol = headers.indexOf('Hotel');
  const targetCol = headers.indexOf(header);
  if (targetCol < 0) throw new Error('HOTELS does not contain the column: ' + header);

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][hotelCol] || '').trim() === hotel) {
      sheet.getRange(r + 1, targetCol + 1).setValue(value);
      return;
    }
  }
  throw new Error('Hotel not found in HOTELS: ' + hotel);
}

function hotelExists_(hotel) {
  return rows_(SHEETS.HOTELS).some(r =>
    bool_(r.Active) && String(r.Hotel || '').trim() === hotel
  );
}

function normalizePrice_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : '';
}

/* ------------------------------------------------------------------ */
/* ACCESS                                                             */
/* ------------------------------------------------------------------ */

function activeUserEmail_() {
  try { return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); }
  catch (e) { return ''; }
}

function isAuthorized_(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return false;
  return rows_(SHEETS.ACCESS).some(r =>
    String(r.Email || '').trim().toLowerCase() === target &&
    bool_(r.Active) &&
    ['Events Uploader', 'Finance Admin'].includes(String(r.Role || '').trim())
  );
}

function ensureAccessRow_(email, role) {
  if (!email) return;
  const sheet = ss_().getSheetByName(SHEETS.ACCESS);
  const rows = sheet.getDataRange().getValues();
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][0] || '').trim().toLowerCase() === email.toLowerCase()) return;
  }
  sheet.appendRow([email, role, true]);
}

/* ------------------------------------------------------------------ */
/* GOOGLE DRIVE ARCHIVE                                               */
/* ------------------------------------------------------------------ */

function archiveInDrive_(hotel, attachmentType, category, blob, originalName, stamp) {
  const root = driveRoot_();
  const hotelFolder = childFolder_(root, hotel);
  const typeFolder = childFolder_(hotelFolder, attachmentType);
  const finalFolder = attachmentType === 'Catering Menu'
    ? childFolder_(typeFolder, category)
    : typeFolder;

  const archiveName = stamp + ' - ' + originalName.replace(/[\\/:*?"<>|]+/g, '-');
  return finalFolder.createFile(blob.copyBlob().setName(archiveName));
}

function driveRoot_() {
  let id = getConfig_('DRIVE_ROOT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  const folder = DriveApp.createFolder('GU-Q Catering Catalogue Upload Archive');
  setConfig_('DRIVE_ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function childFolder_(parent, name) {
  const clean = String(name || 'General').replace(/[\\/:*?"<>|]+/g, '-').trim();
  const matches = parent.getFoldersByName(clean);
  return matches.hasNext() ? matches.next() : parent.createFolder(clean);
}

/* ------------------------------------------------------------------ */
/* UPLOAD LOG                                                         */
/* ------------------------------------------------------------------ */

function markPreviousNotCurrent_(hotel, attachmentType, category) {
  const sheet = ss_().getSheetByName(SHEETS.LOG);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;

  const headers = values[0].map(v => String(v || '').trim());
  const H = {};
  headers.forEach((h, i) => H[h] = i);

  for (let r = 1; r < values.length; r++) {
    if (
      String(values[r][H.Hotel] || '').trim() === hotel &&
      String(values[r][H['Attachment Type']] || '').trim() === attachmentType &&
      String(values[r][H.Category] || '').trim() === category &&
      bool_(values[r][H.Current])
    ) {
      sheet.getRange(r + 1, H.Current + 1).setValue(false);
    }
  }
}

function appendUploadLog_(x) {
  const sheet = ss_().getSheetByName(SHEETS.LOG);
  sheet.appendRow([
    Utilities.getUuid(),
    x.hotel || '',
    x.attachmentType || '',
    x.category || '',
    x.originalName || '',
    x.driveFileId || '',
    x.publishedLink || '',
    !!x.current,
    new Date(),
    x.uploadedBy || '',
    x.githubStatus || '',
    x.githubCommitUrl || '',
    x.notes || ''
  ]);
}

function ss_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty('SPREADSHEET_ID', active.getId());
    return active;
  }
  throw new Error('Spreadsheet ID is not configured. Open the Finance control Sheet and run “Run backend setup” once.');
}

/* ------------------------------------------------------------------ */
/* CONFIG                                                             */
/* ------------------------------------------------------------------ */

function getConfig_(key) {
  const sheet = ss_().getSheetByName(SHEETS.CONFIG);
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0] || '').trim() === key) return String(values[r][1] || '').trim();
  }
  return '';
}

function setConfig_(key, value) {
  const sheet = ss_().getSheetByName(SHEETS.CONFIG);
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0] || '').trim() === key) {
      sheet.getRange(r + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value, 'AUTO']);
}

/* ------------------------------------------------------------------ */
/* GITHUB                                                             */
/* ------------------------------------------------------------------ */

function githubConfig_() {
  const owner = getConfig_('GITHUB_OWNER');
  const repo = getConfig_('GITHUB_REPO');
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!owner) throw new Error('CONFIG → GITHUB_OWNER is blank.');
  if (!repo) throw new Error('CONFIG → GITHUB_REPO is blank.');
  if (!token) throw new Error('GitHub token is not saved. Use Catering Catalogue → Save GitHub token.');
  return { owner, repo, token };
}

function githubHeaders_(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GUQ-Catering-Catalogue'
  };
}

function githubUpsertText_(path, text, message) {
  return githubUpsertBytes_(path, Utilities.newBlob(text, 'application/json', path).getBytes(), message);
}

function githubUpsertBytes_(path, bytes, message) {
  const cfg = githubConfig_();
  const apiPath = path.split('/').map(encodeURIComponent).join('/');
  const api = 'https://api.github.com/repos/' +
    encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
    '/contents/' + apiPath;

  const existing = UrlFetchApp.fetch(api + '?ref=' + encodeURIComponent(GITHUB_BRANCH), {
    method: 'get',
    headers: githubHeaders_(cfg.token),
    muteHttpExceptions: true
  });

  let sha = '';
  if (existing.getResponseCode() === 200) {
    sha = JSON.parse(existing.getContentText()).sha || '';
  } else if (existing.getResponseCode() !== 404) {
    throw new Error('GitHub lookup failed for ' + path + ' (HTTP ' +
      existing.getResponseCode() + '): ' + existing.getContentText().slice(0, 500));
  }

  const body = {
    message: message || ('Update ' + path),
    content: Utilities.base64Encode(bytes),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;

  const response = UrlFetchApp.fetch(api, {
    method: 'put',
    contentType: 'application/json',
    headers: githubHeaders_(cfg.token),
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub publish failed for ' + path + ' (HTTP ' +
      code + '): ' + response.getContentText().slice(0, 800));
  }

  const result = JSON.parse(response.getContentText());
  return {
    path,
    contentUrl: result.content && result.content.html_url ? result.content.html_url : '',
    commitUrl: result.commit && result.commit.html_url ? result.commit.html_url : ''
  };
}

/* ------------------------------------------------------------------ */
/* SMALL HELPERS                                                      */
/* ------------------------------------------------------------------ */

function bool_(v) {
  if (v === true) return true;
  return ['true', 'yes', '1'].includes(String(v || '').trim().toLowerCase());
}

function slug_(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'attachment';
}

/* ------------------------------------------------------------------ */
/* EVENTS PORTAL HTML — embedded here so there is only ONE backend    */
/* code file to install.                                              */
/* ------------------------------------------------------------------ */

function uploadPortalHtml_() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GU-Q Catering Attachment Upload</title>
<style>
:root{--navy:#071b33;--navy2:#102c4f;--cream:#f6f4ef;--gold:#c9a468;--ink:#172033;--muted:#667085;--green:#1d6b50;--red:#a12626}
*{box-sizing:border-box}body{margin:0;background:var(--cream);font-family:Arial,sans-serif;color:var(--ink)}
.top{background:var(--navy);color:white;padding:20px}.shell{width:min(760px,calc(100% - 28px));margin:auto}
.brand{font-family:Georgia,serif;font-size:22px;font-weight:bold}.sub{opacity:.78;margin-top:4px;font-size:13px}
.card{background:white;border:1px solid #dedbd3;border-radius:18px;margin:26px auto;padding:28px;box-shadow:0 14px 35px rgba(7,27,51,.08)}
h1{font-family:Georgia,serif;color:var(--navy);font-size:28px;margin:0 0 8px}.lead{color:var(--muted);line-height:1.55;margin:0 0 24px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.full{grid-column:1/-1}
label{display:block;font-size:12px;font-weight:bold;color:var(--navy);margin-bottom:7px;text-transform:uppercase;letter-spacing:.06em}
input,select,textarea{width:100%;border:1px solid #cfd4dc;border-radius:10px;padding:12px;background:#fff;font:inherit}
textarea{min-height:90px;resize:vertical}.hint{font-size:12px;color:var(--muted);margin-top:6px}
button{border:0;border-radius:10px;background:var(--navy);color:white;padding:13px 19px;font-weight:bold;cursor:pointer}
button:disabled{opacity:.55;cursor:wait}.actions{display:flex;align-items:center;gap:14px;margin-top:22px}
#msg{font-size:13px;line-height:1.45}.ok{color:var(--green)}.err{color:var(--red)}
.notice{background:#f8f1df;border:1px solid #e8d49d;border-radius:10px;padding:12px 14px;color:#684d0d;font-size:13px;line-height:1.45;margin-bottom:20px}
@media(max-width:620px){.grid{grid-template-columns:1fr}.full{grid-column:auto}.card{padding:20px}}
</style>
</head>
<body>
<div class="top"><div class="shell"><div class="brand">Georgetown University in Qatar</div><div class="sub">Events · Catering Attachment Upload</div></div></div>
<div class="shell">
<form id="uploadForm" class="card" onsubmit="submitUpload(this);return false;">
  <h1>Add or replace an attachment</h1>
  <p class="lead">Choose the venue and attachment type, add one PDF, and submit. The catalogue is updated automatically; no GitHub or spreadsheet editing is required.</p>
  <div id="authNotice" class="notice">Loading your access…</div>
  <div class="grid">
    <div class="full">
      <label for="uploader_email">Your Georgetown email</label>
      <input id="uploader_email" name="uploader_email" type="email" placeholder="name@georgetown.edu" required>
      <div class="hint">Used only when Google does not expose your signed-in email to Apps Script.</div>
    </div>
    <div>
      <label for="hotel">Hotel / venue</label>
      <select id="hotel" name="hotel" required><option value="">Loading…</option></select>
    </div>
    <div>
      <label for="attachment_type">Attachment type</label>
      <select id="attachment_type" name="attachment_type" required onchange="toggleFields()">
        <option value="">Select…</option>
        <option>Catering Menu</option>
        <option>Meeting Spaces</option>
        <option>Hotel Attachment</option>
      </select>
    </div>
    <div id="categoryWrap" style="display:none">
      <label for="category">Catering category</label>
      <select id="category" name="category" onchange="toggleFields()"></select>
    </div>
    <div id="newCategoryWrap" style="display:none">
      <label for="new_category">New category name</label>
      <input id="new_category" name="new_category" placeholder="e.g. Ramadan Iftar">
    </div>
    <div id="labelWrap" style="display:none" class="full">
      <label for="attachment_label">Attachment label</label>
      <input id="attachment_label" name="attachment_label" placeholder="e.g. Event brochure">
    </div>
    <div class="full">
      <label for="attachment">PDF attachment</label>
      <input id="attachment" name="attachment" type="file" accept="application/pdf,.pdf" required>
      <div class="hint" id="sizeHint">PDF only.</div>
    </div>
    <div class="full">
      <label for="notes">Notes (optional)</label>
      <textarea id="notes" name="notes" placeholder="Anything Finance should know about this update"></textarea>
    </div>
  </div>
  <div class="actions"><button id="submitBtn" type="submit">Upload & publish</button><div id="msg"></div></div>
</form>
</div>
<script>
let OPTIONS={hotels:[],categories:[],maxUploadMb:25};

google.script.run.withSuccessHandler(init).withFailureHandler(showError).getUploaderOptions();

function init(o){
  OPTIONS=o||OPTIONS;
  const h=document.getElementById('hotel');
  h.innerHTML='<option value="">Select venue…</option>'+OPTIONS.hotels.map(x=>'<option>'+esc(x)+'</option>').join('');
  const c=document.getElementById('category');
  c.innerHTML='<option value="">Select category…</option>'+OPTIONS.categories.map(x=>'<option>'+esc(x)+'</option>').join('')+'<option>+ New category</option>';
  const email=document.getElementById('uploader_email');
  if(OPTIONS.activeEmail){email.value=OPTIONS.activeEmail;email.readOnly=true}
  document.getElementById('sizeHint').textContent='PDF only · maximum '+OPTIONS.maxUploadMb+' MB.';
  document.getElementById('authNotice').textContent=OPTIONS.activeEmailAuthorized
    ? 'Access recognized for '+OPTIONS.activeEmail+'.'
    : 'Only emails listed as active in the Finance ACCESS tab can publish.';
}
function toggleFields(){
  const t=document.getElementById('attachment_type').value;
  const isMenu=t==='Catering Menu';
  document.getElementById('categoryWrap').style.display=isMenu?'block':'none';
  const isNew=isMenu&&document.getElementById('category').value==='+ New category';
  document.getElementById('newCategoryWrap').style.display=isNew?'block':'none';
  document.getElementById('labelWrap').style.display=t==='Hotel Attachment'?'block':'none';
}
function submitUpload(form){
  const btn=document.getElementById('submitBtn'),msg=document.getElementById('msg');
  msg.className='';msg.textContent='Uploading…';btn.disabled=true;
  google.script.run.withSuccessHandler(r=>{
    btn.disabled=false;msg.className='ok';msg.textContent='✓ '+(r.message||'Published');
    form.reset(); if(OPTIONS.activeEmail){form.uploader_email.value=OPTIONS.activeEmail}
    toggleFields();
  }).withFailureHandler(e=>{btn.disabled=false;showError(e)}).uploadAttachment(form);
}
function showError(e){
  const msg=document.getElementById('msg');msg.className='err';msg.textContent='✕ '+(e&&e.message?e.message:e);
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
</script>
</body>
</html>`;
}
