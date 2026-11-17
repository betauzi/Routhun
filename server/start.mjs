import { openDatabase, seedDemo } from './db.mjs';
import { createApp } from './index.mjs';
const demo = process.env.DEMO_MODE === 'true' || (process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false');
const db = openDatabase();
if (demo) seedDemo(db);
const port = Number(process.env.PORT || 3001);
createApp(db).listen(port, () => console.log(`Routhun API http://127.0.0.1:${port} (demo=${demo})`));
