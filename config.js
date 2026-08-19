/**
 * GU-Q Catering Catalogue — one-time GitHub configuration.
 *
 * Deploy google-apps-script/Code.gs as a Google Apps Script Web App,
 * then paste its deployed /exec URL below.
 *
 * After that one-time connection:
 *   - hotel images come ONLY from Suppliers!image_url
 *   - menu/attachment links come ONLY from Hotel Categories!menu_url
 *   - prices/content/settings come from Google Sheets
 */
window.GUQ_CATERING_CONFIG = {
  SHEET_API_URL: "https://script.google.com/macros/s/AKfycbytl5Y28mYB9bv2GnlyBuOGwaEMNpsQW9hDvgCD9-7btRNOGloR--p8DamG7zBXjF8o/exec",
  REQUEST_TIMEOUT_MS: 12000
};
