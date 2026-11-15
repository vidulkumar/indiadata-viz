import { getLocalDb, seedLocalBoundaries, getLocalDbPath } from './local-db.mjs';

const db = getLocalDb();
const count = seedLocalBoundaries(db, true);
const byTier = db
  .prepare('SELECT level, COUNT(*) as count FROM boundary_features GROUP BY level ORDER BY count ASC')
  .all();

console.log(`✅ Local SQLite database seeded at: ${getLocalDbPath()}`);
console.log(`✅ Total verified GIS boundary features: ${count}`);
for (const row of byTier) {
  console.log(`   - ${row.level}: ${row.count} features`);
}
