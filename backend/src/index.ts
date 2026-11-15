// Load and validate configuration first: the server refuses to start without its secrets.
import { FRONTEND_URL } from './lib/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import meetingRoutes from './routes/meetings';
import actionItemRoutes from './routes/actionItems';
import meetingNoteRoutes from './routes/meetingNotes';
import groupRoutes from './routes/groups';
import aiRoutes from './routes/ai';
import userRoutes from './routes/users';
import calendarRoutes from './routes/calendar';
import reportRoutes from './routes/reports';
import adminRoutes from './routes/admin';
import { mailMode } from './lib/mailer';
import { startNotificationScheduler } from './lib/notifications';

const app = express();
const port = process.env.PORT || 5001;

app.use(helmet({ contentSecurityPolicy: false }));
// Which website addresses may call the API. Always the configured FRONTEND_URL; during development also any
// address on this computer (localhost / 127.0.0.1 / [::1], any port), e.g. when Vite picks another port.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
app.use(cors({
  origin: (origin, callback) => {
    const allowed = !origin || origin === FRONTEND_URL || (process.env.NODE_ENV !== 'production' && LOCAL_ORIGIN.test(origin));
    callback(null, allowed);
  },
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api', groupRoutes); // /api/projects/:id/groups and /api/groups/...
app.use('/api', meetingNoteRoutes); // /api/meetings/:id/notes, /agenda ... and /api/meeting-notes/...
app.use('/api', actionItemRoutes); // /api/meetings/:id/action-items and /api/action-items/...
app.use('/api/meetings', meetingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

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
