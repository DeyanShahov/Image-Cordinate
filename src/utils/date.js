/**
 * Date formatting and grouping utilities for gallery organization.
 * Uses Bulgarian locale for user-facing strings.
 */

const BG_LOCALE = 'bg-BG';

/** @returns {string} e.g. "Седмица 38 (22-28 сеп)" */
export function formatWeekLabel(date) {
  const d = new Date(date);
  const weekNum = getISOWeekNumber(d);
  const weekStart = getWeekStart(d);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  
  const startStr = weekStart.toLocaleDateString(BG_LOCALE, { day: 'numeric', month: 'short' });
  const endStr = weekEnd.toLocaleDateString(BG_LOCALE, { day: 'numeric', month: 'short' });
  
  return `Седмица ${weekNum} (${startStr}–${endStr})`;
}

/** @returns {string} e.g. "Понеделник, 23 септември" */
export function formatDayLabel(date) {
  const d = new Date(date);
  return d.toLocaleDateString(BG_LOCALE, { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long' 
  });
}

/** @returns {string} Short format: "23.09 Пон" */
export function formatDayLabelShort(date) {
  const d = new Date(date);
  return d.toLocaleDateString(BG_LOCALE, { 
    weekday: 'short', 
    day: '2-digit', 
    month: '2-digit' 
  });
}

/** @returns {{ weekStart: Date, weekEnd: Date }} Monday-Sunday bounds */
export function getWeekBounds(date) {
  const d = new Date(date);
  const weekStart = getWeekStart(d);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

/** @returns {Date} Monday 00:00:00 of the given date's week */
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = (day === 0 ? -6 : 1) - day; // Monday = 1
  d.setDate(d.getDate() + diff);
  return d;
}

/** ISO week number (1-53) */
function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/** @returns {boolean} True if date is today (local timezone) */
export function isToday(date) {
  const d = new Date(date);
  const today = new Date();
  return d.getDate() === today.getDate() &&
         d.getMonth() === today.getMonth() &&
         d.getFullYear() === today.getFullYear();
}

/** @returns {string} ISO date string "YYYY-MM-DD" for grouping key */
export function getDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** @returns {string} ISO week string "YYYY-Www" for grouping key */
export function getWeekKey(date) {
  const d = new Date(date);
  const weekNum = getISOWeekNumber(d);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Groups photos by week then by day.
 * @param {Array<{createdAt: number, ...}>} photos - Photos sorted by createdAt DESC
 * @returns {Array<{ weekKey, weekLabel, weekStart, weekEnd, days: Array<{ dateKey, dayLabel, dayLabelShort, date, photos, count, isToday }> }>}
 */
export function groupByWeekAndDay(photos) {
  // First pass: group by date
  const byDate = new Map();
  for (const photo of photos) {
    const dateKey = getDateKey(photo.createdAt);
    if (!byDate.has(dateKey)) {
      const date = new Date(photo.createdAt);
      byDate.set(dateKey, {
        dateKey,
        date,
        dayLabel: formatDayLabel(photo.createdAt),
        dayLabelShort: formatDayLabelShort(photo.createdAt),
        isToday: isToday(photo.createdAt),
        photos: [],
        count: 0,
      });
    }
    byDate.get(dateKey).photos.push(photo);
    byDate.get(dateKey).count++;
  }

  // Second pass: group dates by week
  const byWeek = new Map();
  for (const [dateKey, dayData] of byDate) {
    const weekKey = getWeekKey(dayData.date);
    if (!byWeek.has(weekKey)) {
      const { weekStart, weekEnd } = getWeekBounds(dayData.date);
      byWeek.set(weekKey, {
        weekKey,
        weekLabel: formatWeekLabel(dayData.date),
        weekStart,
        weekEnd,
        days: [],
      });
    }
    byWeek.get(weekKey).days.push(dayData);
  }

  // Convert to sorted arrays: weeks DESC, days DESC within week
  const weeks = Array.from(byWeek.values()).map(week => ({
    ...week,
    days: week.days
      .sort((a, b) => b.date - a.date) // newest day first
      .map(day => ({ ...day, photos: day.photos.sort((a, b) => b.createdAt - a.createdAt) })),
  })).sort((a, b) => b.weekStart - a.weekStart); // newest week first

  return weeks;
}