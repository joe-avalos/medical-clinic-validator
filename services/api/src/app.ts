import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from './middleware/auth.js';
import { verifyRouter } from './routes/verify.js';
import { recordsRouter } from './routes/records.js';
import { telemetryRouter } from './routes/telemetry.js';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_PER_MINUTE) || 200,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// Health check — unauthenticated
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(authMiddleware);

app.use('/verify', verifyRouter);
app.use('/records', recordsRouter);
app.use('/telemetry', telemetryRouter);