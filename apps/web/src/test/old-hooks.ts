// The retired mark's two hooks as each platform drew them: the web and Android outlines on their
// 512-unit grid, the names that colored them apart, and the Swift path's points and radius.
export const OLD_HOOKS: readonly string[] = [
  "M86 160L86 266",
  "M426 352L426 246",
  "A120 120 0 0 0 326 266",
  "--hook-a",
  "--hook-b",
  "86, y: 160",
  "426, y: 352",
  "radius: 120",
  "512-unit",
];

// Each needle a file still holds, as "path: needle".
export const oldHooksIn = (path: string, text: string) =>
  OLD_HOOKS.filter((needle) => text.includes(needle)).map((needle) => `${path}: ${needle}`);
