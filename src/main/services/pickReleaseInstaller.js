"use strict";

/**
 * 与 CI 产物命名规则一致（v0.6.1 起 artifactName 统一为 MatrixMedia-${version}-${os}-${arch}.${ext}）：
 *   Win x64:      MatrixMedia-0.6.1-win-x64.exe
 *   Mac x64:      MatrixMedia-0.6.1-mac-x64.dmg
 *   Mac arm64:    MatrixMedia-0.6.1-mac-arm64.dmg
 *
 * 兼容历史命名（旧 Release 包仍可正常升级）：
 *   旧 Win: Setup-0.6.0-win-x64.exe
 *   旧 Mac: 矩媒-0.6.0-arm64.dmg / 矩媒-0.6.0.dmg
 *
 * x64 经 Rosetta 跑时 process.arch 仍是 x64，必须用 translated 判断真实芯片。
 */
export function preferMacArm({ arch, translated } = {}) {
  return arch === "arm64" || Boolean(translated);
}

export function pickReleaseInstaller(assets, env = {}) {
  const list = assets || [];
  const platform = env.platform || process.platform;
  const arch = env.arch || process.arch;
  const translated = env.translated;

  if (platform === "win32") {
    return (
      list.find((a) => /-win-x64\.exe$/i.test(a.name)) ||
      list.find((a) => /\.exe$/i.test(a.name))
    );
  }
  if (platform === "darwin") {
    const dmgs = list.filter((a) => /\.dmg$/i.test(a.name));
    const x64Dmg = dmgs.find((a) => /-(mac-)?x64\.dmg$/i.test(a.name));
    const universalDmg = dmgs.find((a) => /-universal\.dmg$/i.test(a.name));
    const armDmg = dmgs.find((a) => /-arm64\.dmg$/i.test(a.name));
    const plainDmg = dmgs.find(
      (a) =>
        !/-arm64\.dmg$/i.test(a.name) &&
        !/-(mac-)?x64\.dmg$/i.test(a.name) &&
        !/-universal\.dmg$/i.test(a.name)
    );

    if (preferMacArm({ arch, translated })) {
      return armDmg || universalDmg || x64Dmg || plainDmg || null;
    }
    return x64Dmg || universalDmg || plainDmg || armDmg || null;
  }
  return null;
}
