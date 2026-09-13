import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount between tests. Without this, hooks from earlier tests keep their
// window-level key listeners attached and every later keypress fires all of them.
afterEach(cleanup);
