/**
 * Electron fuses for the desktop builds (scripts/package-desktop.mjs flips them on the packaged binary). Fuses are
 * switches baked into the Electron executable itself, so they hold even if someone edits the app's files:
 * - RunAsNode / NODE_OPTIONS / --inspect off: the Winterland executable can't be used to run arbitrary Node code;
 * - only load the app from app.asar, and (macOS and Windows, where Electron supports it) check that app.asar is the
 *   one this build shipped (packager writes its hash into the executable);
 * - no extra privileges for file:// pages (the game uses its own app:// scheme).
 */
import { FuseV1Options, FuseVersion } from '@electron/fuses';

/** Where the Electron executable sits inside a packaged folder (what flipFuses takes). */
export function electronBinary(dir, platform, executableName) {
  if (platform === 'darwin') return `${dir}/Winterland.app`;
  if (platform === 'win32') return `${dir}/${executableName}.exe`;
  return `${dir}/${executableName}`;
}

export function fuseConfig(platform) {
  return {
    version: FuseVersion.V1,
    // package-desktop.mjs signs the macOS app itself, after the fuses are flipped
    resetAdHocDarwinSignature: false,
    strictlyRequireAllFuses: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: platform === 'darwin' || platform === 'win32',
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  };
}
