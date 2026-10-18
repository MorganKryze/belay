// Before Testing Library, which loads React.
import "./animation-event";
import { configure } from "@testing-library/react";
// IndexedDB for jsdom, which has none: every test file gets an in-memory one.
import "fake-indexeddb/auto";

// Lazy routes load real modules on first use; a cold run (CI) can take more than the default
// second before the first findBy* resolves.
configure({ asyncUtilTimeout: 5000 });

// jsdom implements no scrolling; the router's scroll restoration calls this on every navigation.
window.scrollTo = () => {};

// jsdom has no IntersectionObserver; one that never reports leaves the observed element as it is.
window.IntersectionObserver = class {
  observe() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;
