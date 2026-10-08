import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();
const prisma = new PrismaClient();

// Initialize the Gemini API client
// If the key is missing, it will throw an error, which is caught gracefully below
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Generate a draft via AI
router.post('/generate', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const { meetingId, draftType, prompt } = req.body; // INVITATION, AGENDA, REMINDER, SUMMARY

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
    }

    // Get the meeting context to feed the AI
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { project: true }
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });

    let systemInstruction = '';
    if (draftType === 'INVITATION') {
      systemInstruction = `You are an AI assistant helping a project manager write a professional meeting invitation. 
      Project Name: ${meeting.project.name}. Meeting Title: ${meeting.title}. 
      Task: Write a concise, polite email invitation based on the following user prompt.`;
    } else if (draftType === 'AGENDA') {
      systemInstruction = `You are an AI assistant helping organize a meeting. 
      Project Name: ${meeting.project.name}. Meeting Title: ${meeting.title}. 
      Task: Generate a clear, structured bullet-point meeting agenda based on the following user prompt.`;
    } else if (draftType === 'SUMMARY') {
      systemInstruction = `You are an AI assistant generating meeting minutes.
      Project Name: ${meeting.project.name}. Meeting Title: ${meeting.title}. 
      Task: Summarize the following meeting notes into a professional summary with clear action items.`;
    } else {
      systemInstruction = `You are a helpful AI assistant drafting a document for a meeting called ${meeting.title}.`;
    }

    const fullPrompt = `${systemInstruction}\n\nUser Prompt: ${prompt}`;

    let result;
    let retries = 3;
    while (retries > 0) {
      try {
        result = await model.generateContent(fullPrompt);
        break;
      } catch (err: any) {
        if (err.message && err.message.includes('503') && retries > 1) {
          console.warn(`503 High Demand Error. Retrying... (${retries - 1} attempts left)`);
          await new Promise(res => setTimeout(res, 2000));
          retries--;
        } else {
          throw err;
        }
      }
    }
    
    if (!result) throw new Error('Failed to generate content from Gemini after retries.');
    const generatedContent = result.response.text();

    const draft = await prisma.aiDraft.create({
      data: {
        meetingId,
        userId,
        draftType,
        content: generatedContent
      }
    });

    res.status(201).json(draft);
  } catch (error: any) {
    console.error('Error generating AI draft:', error);
    res.status(500).json({ error: 'Failed to generate AI draft: ' + (error.message || 'Unknown error') });
  }
});

export default router;
