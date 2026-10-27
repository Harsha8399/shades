/**
 * Test setup.
 *
 * Points the database at a temporary location so tests never touch the
 * real `data/trades.db`, and silences the very chatty console output the
 * trading engine produces.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shades-test-'));

// Point the DB at a throwaway file for the duration of the test run.
process.env.SHADES_DB_PATH = path.join(tmpDir, 'test-trades.db');
process.env.NODE_ENV = 'test';
