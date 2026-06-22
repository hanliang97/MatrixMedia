const accountLoginWindows = new Map();

function isWindowAlive(win) {
  return win && (!win.isDestroyed || !win.isDestroyed());
}

export function registerAccountLoginWindow(win, partition) {
  if (!win || !partition) return;
  accountLoginWindows.set(partition, win);
  win._mmAccountLoginPartition = partition;
  if (typeof win.on === "function") {
    win.on("closed", () => {
      if (accountLoginWindows.get(partition) === win) {
        accountLoginWindows.delete(partition);
      }
    });
  }
}

export function getAccountLoginWindowByPartition(partition) {
  const win = accountLoginWindows.get(partition);
  if (isWindowAlive(win)) return win;
  accountLoginWindows.delete(partition);
  return null;
}

export function closeOtherAccountLoginWindows(partition) {
  for (const [currentPartition, win] of accountLoginWindows.entries()) {
    if (!isWindowAlive(win)) {
      accountLoginWindows.delete(currentPartition);
      continue;
    }
    if (currentPartition === partition) continue;
    try {
      win.close();
    } catch (_) {
      /* ignore */
    }
  }
}

export function destroyAccountLoginWindows() {
  for (const [partition, win] of accountLoginWindows.entries()) {
    if (!isWindowAlive(win)) {
      accountLoginWindows.delete(partition);
      continue;
    }
    try {
      win.destroy();
    } catch (_) {
      /* ignore */
    }
  }
  accountLoginWindows.clear();
}
