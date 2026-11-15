// One-time (safe to repeat) conversion: encrypts AI drafts, notes and agendas that were stored before
// encryption at rest was added. Run from the backend folder:  npx tsx prisma/encrypt-existing.ts
import { PrismaClient } from '@prisma/client';
import { isSealed, seal } from '../src/lib/secureText';

const prisma = new PrismaClient();

async function main() {
  let drafts = 0, notes = 0, agendas = 0;
  for (const d of await prisma.aiDraft.findMany({ select: { id: true, content: true } })) {
    if (d.content && !isSealed(d.content)) { await prisma.aiDraft.update({ where: { id: d.id }, data: { content: seal(d.content) } }); drafts++; }
  }
  for (const n of await prisma.meetingNote.findMany({ select: { id: true, content: true } })) {
    if (n.content && !isSealed(n.content)) { await prisma.meetingNote.update({ where: { id: n.id }, data: { content: seal(n.content) } }); notes++; }
  }
  for (const m of await prisma.meeting.findMany({ where: { agenda: { not: null } }, select: { id: true, agenda: true } })) {
    if (m.agenda && !isSealed(m.agenda)) { await prisma.meeting.update({ where: { id: m.id }, data: { agenda: seal(m.agenda) } }); agendas++; }
  }
  console.log(`Encrypted ${drafts} AI draft(s), ${notes} note(s), ${agendas} agenda(s).`);
}

main().finally(() => prisma.$disconnect());
