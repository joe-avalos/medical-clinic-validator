import { app } from './app.js';
import { getSecrets } from './clients/secrets.js';

const PORT = process.env.PORT || 3000;

async function main(): Promise<void> {
  const secrets = await getSecrets();

  // Inject secrets into process.env so auth middleware reads JWT_SECRET at module level
  process.env.JWT_SECRET = secrets.JWT_SECRET;

  app.listen(PORT, () => {
    console.log(`[API] Listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('[API] Fatal startup error:', err);
  process.exit(1);
});
