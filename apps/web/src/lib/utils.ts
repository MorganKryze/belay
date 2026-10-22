import { createCn } from "cn/engine";
import tables from "./cn-tables";

// The merge tables are compiled from index.css (pnpm cn:tables), so the --text-* type steps count
// as sizes: text-section next to text-muted-foreground keeps both.
export const cn = createCn(tables);
