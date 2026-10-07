// Sizes of one sync, apart from the Zod schemas so the phone's initial bundle can read them.
export const MAX_CHANGES = 500; // per request
export const MAX_ROWS = 1000; // per answer, then hasMore
export const MAX_BODY_BYTES = 256 * 1024;
