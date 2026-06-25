const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function toISODate(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeAmPm(token) {
  if (!token) return '';
  return token.replace(/\./g, '').toUpperCase();
}

function normalizeTimeValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  // Already in 24-hour format.
  const military = text.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const h = Number(military[1]);
    const m = Number(military[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad(h)}:${pad(m)}`;
  }

  const twelve = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|A\.M\.|P\.M\.)$/i);
  if (twelve) {
    let h = Number(twelve[1]);
    const m = Number(twelve[2] || '00');
    const ap = normalizeAmPm(twelve[3]);
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad(h)}:${pad(m)}`;
  }

  return text;
}

function parseDateValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  // YYYY-MM-DD
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return toISODate(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  // M/D/YYYY or M/D/YY
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    return toISODate(new Date(year, Number(slash[1]) - 1, Number(slash[2])));
  }

  // July 6, 2026 / July 6 2026
  const monthPattern = new RegExp(`^(${months.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{4})$`, 'i');
  const monthMatch = text.match(monthPattern);
  if (monthMatch) {
    const monthIndex = months.findIndex((m) => m.toLowerCase() === monthMatch[1].toLowerCase());
    return toISODate(new Date(Number(monthMatch[3]), monthIndex, Number(monthMatch[2])));
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return toISODate(parsed);

  return text;
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line, rowIndex) => {
    const values = splitCsvLine(line);
    const row = { _rowNumber: rowIndex + 2 };
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

function valueFrom(row, keys) {
  for (const key of keys) {
    const normalized = key.toLowerCase();
    if (row[normalized] !== undefined && String(row[normalized]).trim() !== '') return row[normalized];
  }
  return '';
}

export async function parseCalendarCsv(file) {
  const text = await file.text();
  const rows = parseCsv(text);

  const lectures = rows.map((row) => {
    const date = parseDateValue(valueFrom(row, ['date', 'day', 'lecture date', 'class date']));
    const startTime = normalizeTimeValue(valueFrom(row, ['startTime', 'start time', 'start', 'time']));
    const endTime = normalizeTimeValue(valueFrom(row, ['endTime', 'end time', 'end']));
    const course = valueFrom(row, ['course', 'class', 'subject area', 'discipline']);
    const title = valueFrom(row, ['title', 'lecture', 'lecture title', 'topic', 'subject']);
    const instructor = valueFrom(row, ['instructor', 'professor', 'faculty']);
    const source = valueFrom(row, ['source', 'notes']);

    return {
      date,
      startTime,
      endTime,
      course: String(course || '').trim(),
      title: String(title || '').trim(),
      instructor: String(instructor || '').trim(),
      source: String(source || 'CSV import').trim(),
      rawLine: `CSV row ${row._rowNumber}`,
      _rowNumber: row._rowNumber
    };
  }).filter((lecture) => lecture.date && lecture.title);

  return lectures.sort((a, b) => `${a.date} ${a.startTime} ${a.title}`.localeCompare(`${b.date} ${b.startTime} ${b.title}`));
}

export function todayISO() {
  return toISODate(new Date());
}
