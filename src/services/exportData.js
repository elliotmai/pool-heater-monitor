/**
 * Client-side data export.
 *
 * Every view already holds the rows it is showing, so an export is a pure
 * browser operation: serialize what's on screen, hand the blob to the browser,
 * done. No extra Firebase reads, and a download always matches exactly what the
 * user was looking at (current filters, window and paging included).
 *
 * Two formats, because they answer different questions:
 *   CSV  — one flat table, for spreadsheets.
 *   JSON — the structured payload, for scripts (keeps nesting CSV would flatten
 *          away, e.g. all-time records or per-sensor stat groups).
 */

/**
 * RFC 4180 cell escaping: wrap in quotes when the value contains a quote,
 * comma or newline, and double up any embedded quotes. Log messages routinely
 * contain commas, so skipping this corrupts the column layout.
 */
const escapeCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Serialize rows to CSV. `columns` is [{ key, label }] — it fixes the column
 * order and gives the header human-readable names ("Living Room (°F)" rather
 * than the raw sensor key).
 */
export const toCSV = (rows, columns) => {
  const header = columns.map(col => escapeCell(col.label ?? col.key)).join(',');
  const body = (rows || []).map(row => columns.map(col => escapeCell(row?.[col.key])).join(','));
  // CRLF: what Excel expects, and every other tool tolerates.
  return [header, ...body].join('\r\n');
};

/** Serialize a payload to pretty-printed JSON. */
export const toJSON = (payload) => JSON.stringify(payload, null, 2);

/** `20260831-1432` — sortable, and safe in a filename on every platform. */
export const timestampSlug = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
};

/**
 * Round a temperature-ish number for export; pass non-numbers through. A
 * non-finite number becomes null so callers export an empty cell rather than
 * the string "NaN".
 */
export const round1 = (value) => {
  if (typeof value !== 'number') return value;
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
};

/** Hand a generated file to the browser as a download. */
export const downloadFile = (filename, content, mimeType) => {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  // Must be in the document for the click to count as user-initiated in Firefox.
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari reads the URL after the click returns, so revoke on the next tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const EXPORT_FORMATS = ['csv', 'json'];

/**
 * Build and download one export.
 *   filename — base name, no extension; the timestamp and extension are added.
 *   rows/columns — the CSV table (also the JSON body unless `json` is given).
 *   json — optional richer payload for the JSON format only.
 * Returns the number of rows written, so callers can confirm what was saved.
 */
export const exportData = ({ format = 'csv', filename, rows = [], columns = [], json }) => {
  const base = `${filename}-${timestampSlug()}`;

  if (format === 'json') {
    const payload = json !== undefined && json !== null
      ? json
      : { exported_at: new Date().toISOString(), count: rows.length, rows };
    downloadFile(`${base}.json`, toJSON(payload), 'application/json');
  } else {
    // Lead with a BOM: without it Excel reads a UTF-8 CSV as its legacy
    // encoding and the °F in the headers arrives as mojibake.
    downloadFile(`${base}.csv`, `\uFEFF${toCSV(rows, columns)}`, 'text/csv');
  }

  return rows.length;
};
