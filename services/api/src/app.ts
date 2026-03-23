import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from './middleware/auth.js';
import { verifyRouter } from './routes/verify.js';
import { recordsRouter } from './routes/records.js';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use(authMiddleware);

app.use('/verify', verifyRouter);
app.use('/records', recordsRouter);