import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL } from './config';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export const isAiConfigured = () => !!process.env.GEMINI_API_KEY;

// Generate text with Gemini, retrying up to 3 times when the service is overloaded (HTTP 503).
export async function generateText(prompt: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err: any) {
      if (attempt < 3 && err?.message?.includes('503')) {
        console.warn(`Gemini 503 (high demand). Retrying... (${3 - attempt} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      throw err;
    }
  }
}
