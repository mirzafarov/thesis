import express from 'express';
import { prisma } from '../lib/prisma';
import { generateText, isAiConfigured } from '../lib/ai';
import { isAiLanguage, meetingContext, writingRules } from '../lib/aiContext';
import { authenticate, getMembership } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

const DRAFT_TYPES = ['INVITATION', 'AGENDA', 'REMINDER', 'SUMMARY'] as const;
type DraftType = (typeof DRAFT_TYPES)[number];

const TASKS: Record<DraftType, string> = {
  INVITATION: 'You help a project manager write a professional meeting invitation email. Write a concise, polite invitation.',
  AGENDA: 'You help organize a meeting. Write a clear, structured bullet-point agenda with approximate times per item.',
  REMINDER: 'You help a project manager remind participants about a meeting. Write a short, friendly reminder.',
  SUMMARY: 'You write meeting minutes. Turn the user\'s notes into a professional summary with a clear list of action items (who does what by when).',
};

/**
 * Generate a draft for a meeting (participants and project managers only).
 * body: { meetingId, draftType, prompt, language: 'en' | 'lt' (default 'en') }
 * The AI receives the meeting's real details (time in your time zone, people, video link, to-dos).
 */
router.post('/generate', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const { meetingId, draftType, prompt } = req.body;
    const language = req.body.language ?? 'en';

    if (!isAiConfigured()) {
      return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
    }
    if (!DRAFT_TYPES.includes(draftType)) return res.status(400).json({ error: 'Invalid draft type' });
    if (!isAiLanguage(language)) return res.status(400).json({ error: 'Language must be English or Lithuanian' });
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) {
      return res.status(400).json({ error: 'Write some instructions or notes (up to 4000 characters)' });
    }

    const context = await meetingContext(String(meetingId), userId);
    if (!context) return res.status(404).json({ error: 'Meeting not found' });
    const { meeting } = context;
    const membership = await getMembership(userId, meeting.projectId);
    const isParticipant = meeting.participants.some(p => p.userId === userId);
    if (!membership || (!isParticipant && membership.role !== 'MANAGER')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const content = await generateText(
      `${TASKS[draftType as DraftType]}\n\nMeeting details:\n${context.text}\n\n${writingRules(language)}\n\nUser's instructions / notes:\n${prompt}`,
    );
    const draft = await prisma.aiDraft.create({ data: { meetingId: meeting.id, userId, draftType, content } });
    res.status(201).json(draft);
  } catch (error: any) {
    console.error('Error generating AI draft:', error);
    res.status(500).json({ error: 'Failed to generate AI draft: ' + (error.message || 'Unknown error') });
  }
});

export default router;
