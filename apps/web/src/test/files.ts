import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Every file under a directory, at any depth; a directory whose name `skip` matches is not
// entered (build output can hold symbolic link loops).
export const walk = (dir: string, skip?: RegExp): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) return [path];
    return skip?.test(name) ? [] : walk(path, skip);
  });
