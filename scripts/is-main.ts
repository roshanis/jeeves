import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * True when the module at `metaUrl` (import.meta.url) is the entry point
 * `argv1` (process.argv[1]). import.meta.url is a percent-encoded, realpath
 * resolved file URL; argv[1] is a raw path, so a space, a non-ASCII character,
 * a symlink or Windows backslashes make a plain string comparison silently false.
 */
export function isMain(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}
