import { configure } from "@testing-library/react";
// IndexedDB for jsdom, which has none: every test file gets an in-memory one.
import "fake-indexeddb/auto";

// Lazy routes load real modules on first use; a cold run (CI) can take more than the default
// second before the first findBy* resolves.
configure({ asyncUtilTimeout: 5000 });
