import { createApp } from './app.js';
import { disconnectPrisma } from './db/prisma.js';

const app = createApp();

const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () => console.log(`SiteSense API listening on http://localhost:${port}`));

async function shutdown() {
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
