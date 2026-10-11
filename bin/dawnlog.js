#!/usr/bin/env node
// Thin shim: npm links bins through a symlink, so all logic lives in src/cli.js.
import { main } from '../src/cli.js';

const { code, stdout, stderr } = main(process.argv.slice(2));
process.stdout.write(stdout);
process.stderr.write(stderr);
// exitCode rather than process.exit(), which can cut off piped output.
process.exitCode = code;
