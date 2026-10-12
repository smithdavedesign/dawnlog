// Loaded with `node --import` in front of the CLI: records every subprocess and network attempt to
// $DAWNLOG_TRAP_LOG (one JSON line each), so a test can assert what dawnlog reached for.
// Builtins are patched on their module objects, then synced into ESM named imports.
import childProcess from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

const log = process.env.DAWNLOG_TRAP_LOG;
const record = (kind, detail) => fs.appendFileSync(log, `${JSON.stringify({ kind, detail })}\n`);

for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const original = childProcess[name];
  childProcess[name] = function trapped(command, ...rest) {
    record('subprocess', { via: name, command: String(command) });
    return original.call(this, command, ...rest);
  };
}
const block = (mod, names, kind) => {
  for (const name of names) {
    mod[name] = (...args) => {
      record(kind, { via: name, target: String(args[0]?.host ?? args[0]?.hostname ?? args[0]) });
      throw new Error(`trap: ${kind} blocked`);
    };
  }
};
block(net, ['connect', 'createConnection'], 'network');
block(tls, ['connect'], 'network');
block(http, ['request', 'get'], 'network');
block(https, ['request', 'get'], 'network');
block(dns, ['lookup', 'resolve'], 'network');
globalThis.fetch = async (url) => {
  record('network', { via: 'fetch', target: String(url) });
  throw new Error('trap: network blocked');
};
syncBuiltinESMExports();
