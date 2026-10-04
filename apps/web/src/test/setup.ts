import { configure } from "@testing-library/react";

// Lazy routes load real modules on first use; a cold run (CI) can take more than the default
// second before the first findBy* resolves.
configure({ asyncUtilTimeout: 5000 });
