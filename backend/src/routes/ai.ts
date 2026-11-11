import express from 'express';
import { prisma } from '../lib/prisma';
import { generateText, isAiConfigured } from '../lib/ai';
import { authenticate, isProjectMember } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

const DRAFT_TYPES = ['INVITATION', 'AGENDA', 'REMINDER', 'SUMMARY'] as const;

// Generate a draft via AI
router.post('/generate', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const { meetingId, draftType, prompt } = req.body;

    if (!isAiConfigured()) {
      return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
    }
    if (!DRAFT_TYPES.includes(draftType)) {
      return res.status(400).json({ error: 'Invalid draft type' });
    }

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { project: true },
    });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!(await isProjectMember(userId, meeting.projectId))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const context = `Project Name: ${meeting.project.name}. Meeting Title: ${meeting.title}.`;
    const tasks: Record<(typeof DRAFT_TYPES)[number], string> = {
      INVITATION: `You are an AI assistant helping a project manager write a professional meeting invitation.
      ${context}
      Task: Write a concise, polite email invitation based on the following user prompt.`,
      AGENDA: `You are an AI assistant helping organize a meeting.
      ${context}
      Task: Generate a clear, structured bullet-point meeting agenda based on the following user prompt.`,
      REMINDER: `You are an AI assistant helping a project manager remind participants about a meeting.
      ${context}
      Task: Write a short, friendly reminder message based on the following user prompt.`,
      SUMMARY: `You are an AI assistant generating meeting minutes.
      ${context}
      Task: Summarize the following meeting notes into a professional summary with clear action items.`,
    };

    const content = await generateText(`${tasks[draftType as (typeof DRAFT_TYPES)[number]]}\n\nUser Prompt: ${prompt}`);

    const draft = await prisma.aiDraft.create({
      data: { meetingId, userId, draftType, content },
    });
    res.status(201).json(draft);
  } catch (error: any) {
    console.error('Error generating AI draft:', error);
    res.status(500).json({ error: 'Failed to generate AI draft: ' + (error.message || 'Unknown error') });
  }
});

export default router;
