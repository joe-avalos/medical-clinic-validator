import { app } from './app.js';
import { getSecrets } from './clients/secrets.js';
import { createLogger } from './shared/logger.js';

const log = createLogger('api');
const PORT = process.env.PORT || 3000;

async function main(): Promise<void> {
  const secrets = await getSecrets();

  // Inject secrets into process.env so auth middleware reads JWT_SECRET at module level
  process.env.JWT_SECRET = secrets.JWT_SECRET;

  app.listen(PORT, () => {
    log.info({ port: PORT }, 'Listening');
  });
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
