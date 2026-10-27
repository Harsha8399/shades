/**
 * Test cleanup. Runs after the test framework is installed, so Jest globals
 * such as `afterAll` are available.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = path.join(os.tmpdir(), 'shades-test-cleanup');

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});
