import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import helmet from 'helmet';
import authRoutes from './routes/auth';


const app = express();
const port = process.env.PORT || 5001;

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json());

import projectRoutes from './routes/projects';
import meetingRoutes from './routes/meetings';
import aiRoutes from './routes/ai';
import userRoutes from './routes/users';
import calendarRoutes from './routes/calendar';

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/calendar', calendarRoutes);

// Fix for Google OAuth Redirect Mismatch
app.get('/api/auth/google/callback', (req, res) => {
  res.redirect(`/api/calendar/google/callback?${new URLSearchParams(req.query as any).toString()}`);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Togrul Meetings Platform API is running' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
