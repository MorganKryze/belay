// Stamped at build time from the release tag; "dev" for any build made outside a release.
export const APP_VERSION: string = __BELAY_VERSION__;

export function releaseUrl(version: string): string | null {
  return version === "dev" ? null : `https://github.com/MorganKryze/belay/releases/tag/v${version}`;
}
