#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { ensureDirectories } from "./config";
import { App } from "./App";

ensureDirectories();
const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<App />);
