// Load and validate configuration first: the server refuses to start without its secrets.
import { FRONTEND_URL } from './lib/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import meetingRoutes from './routes/meetings';
import aiRoutes from './routes/ai';
import userRoutes from './routes/users';
import calendarRoutes from './routes/calendar';
import reportRoutes from './routes/reports';
import { mailMode } from './lib/mailer';
import { startNotificationScheduler } from './lib/notifications';

const app = express();
const port = process.env.PORT || 5001;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/reports', reportRoutes);

// Google may be configured to redirect to /api/auth/google/callback; forward it to the calendar route.
app.get('/api/auth/google/callback', (req, res) => {
  res.redirect(`/api/calendar/google/callback?${new URLSearchParams(req.query as Record<string, string>).toString()}`);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Safe Zone API is running' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`[mail] Emails go to: ${mailMode}`);
  startNotificationScheduler();
});
