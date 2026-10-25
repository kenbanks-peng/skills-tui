import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { ensureDirectories } from "#lib/config";
import { App } from "./App";

ensureDirectories();
// Network reconciliation starts from App after the interface is mounted.
const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<App />);
