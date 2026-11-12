// Fetches the pinned ccusage engine binary into engine/ccusage.exe (idempotent).
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = '@ccusage/ccusage-win32-x64@20.0.50';
const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'ccusage.exe');

if (existsSync(dest)) {
  console.log('engine/ccusage.exe already present, skipping');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'ccusage-'));
try {
  const tgz = execSync(`npm pack ${PKG} --silent`, { cwd: tmp, encoding: 'utf8' }).trim().split(/\r?\n/).pop();
  execFileSync('tar', ['-xf', tgz, 'package/bin/ccusage.exe'], { cwd: tmp });
  mkdirSync(dirname(dest), { recursive: true });
  // Copy next to the destination, then rename: an interrupted copy must never leave a partial
  // exe that the "already present" check would accept forever.
  copyFileSync(join(tmp, 'package', 'bin', 'ccusage.exe'), `${dest}.tmp`);
  renameSync(`${dest}.tmp`, dest);
  console.log('fetched ' + PKG);
} catch (e) {
  console.error(String(e.stderr || e.message));
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
