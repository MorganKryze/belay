import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Every file under a directory, at any depth.
export const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
