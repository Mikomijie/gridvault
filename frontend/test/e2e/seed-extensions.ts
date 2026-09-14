// E2E seed helper: sanctioned overtime cover for every demo persona.
//
// Playwright runs on wall-clock time, so shift rosters would otherwise make
// dossier specs flaky outside shift hours. This inserts scheduled extensions
// (the same mechanism as the backend makeOnDuty helper and a legitimate
// operational record) around now for all five demo users. Runs after
// demo:reset in the Playwright webServer chain; E2E database only.
import { v7 as uuidv7 } from 'uuid';
import { openDatabase } from '../../../backend/src/db/connection.js';
import { usersRepository, scheduledExtensionsRepository } from '../../../backend/src/db/repositories/users.js';

const STAFF = ['GV-9042', 'SN-7742', 'RC-1029', 'AD-0012', 'GV-9101'];

const dbPath = process.env.DATABASE_PATH ?? './data/gridvault.db';
const db = openDatabase(dbPath);
try {
  const now = Date.now();
  for (const staffId of STAFF) {
    const user = usersRepository(db).findByStaffId(staffId);
    if (user === undefined) throw new Error(`demo user missing: ${staffId}`);
    scheduledExtensionsRepository(db).insert({
      id: uuidv7(),
      user_id: user.id,
      starts_at: new Date(now - 12 * 3600000).toISOString(),
      ends_at: new Date(now + 12 * 3600000).toISOString(),
      approved_by: 'GV-9101',
      reason: 'playwright e2e cover',
      created_at: new Date(now).toISOString()
    });
  }
  console.log(`e2e extensions inserted for ${STAFF.length} demo users`);
} finally {
  db.close();
}
