// Sizes of one sync, apart from the Zod schemas so the phone's initial bundle can read them.
export const MAX_CHANGES = 500; // per request
export const MAX_ROWS = 1000; // per answer, then hasMore
export const MAX_BODY_BYTES = 256 * 1024;
// The sync contract's version, served by /api/instance and checked by the native apps. Raised only
// by a change an older client cannot read or write safely; added kinds and fields do not raise it.
export const API_VERSION = 1;
