export function createLaunchInstallerHandler({ platform, spawn, shell, electronApp }) {
  return async function launchInstaller(event, installerPath) {
    if (!installerPath || typeof installerPath !== "string") {
      return { ok: false };
    }

    if (platform === "win32") {
      spawn(installerPath, [], { detached: true, stdio: "ignore" }).unref();
    } else {
      await shell.openPath(installerPath);
    }

    electronApp.quit();
    return { ok: true };
  };
}
