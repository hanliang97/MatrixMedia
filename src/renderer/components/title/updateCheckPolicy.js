export const UPDATE_CHECK_DATE_KEY = "matrixmedia-update-check-date";

export function getUpdateCheckDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shouldRunDailyUpdateCheck({
  storage,
  now = new Date(),
  key = UPDATE_CHECK_DATE_KEY,
} = {}) {
  try {
    const targetStorage =
      storage ||
      (typeof window !== "undefined" && window.localStorage
        ? window.localStorage
        : null);
    if (!targetStorage) return true;

    const today = getUpdateCheckDate(now);
    if (targetStorage.getItem(key) === today) {
      return false;
    }

    targetStorage.setItem(key, today);
    return true;
  } catch (_) {
    return true;
  }
}
