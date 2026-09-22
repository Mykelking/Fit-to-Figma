#!/usr/bin/env node
import { run } from './index.js';

/**
 * The exit code is the whole contract with a script: zero when a tree was
 * written and it validated, non-zero when it did not.
 */
process.exitCode = await run(process.argv.slice(2));
