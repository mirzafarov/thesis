/**
 * Demo data for presenting the system.
 *
 *   npm run demo            create (or re-create) the demo data
 *   npm run demo -- --remove   remove it again
 *
 * All dates are relative to the day you run it, so the Gantt chart always shows past, current and future work.
 * Demo accounts use @demo.safezone.test addresses: the mailer never sends real email to that domain
 * (emails to demo users are saved in backend/mail-outbox instead).
 *
 * Password for all demo accounts: DEMO_PASSWORD from .env, or the default below.
 * These are local demo accounts only — never use this password anywhere real.
 */
import { PrismaClient } from '@prisma/client';
import type { ActivityStatus, MeetingCategory, MeetingStatus, ProjectRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { zonedToUtc } from '../src/lib/timezones';

const prisma = new PrismaClient();
const DOMAIN = 'demo.safezone.test';
const PASSWORD = process.env.DEMO_PASSWORD || 'SafeZone!Demo2026';
const PROJECTS = ['Smart City Mobility Platform', 'Hospital IT Upgrade'];

// ---------- dates relative to today ----------
const today = new Date();
const dayKey = (offset: number) => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
  return d;
};
/** A date-only value (UTC midnight), as the Gantt chart stores it. */
const day = (offset: number) => dayKey(offset);
/** The nearest weekday on or after `offset` days from today. */
const weekday = (offset: number) => {
  let o = offset;
  while ([0, 6].includes(dayKey(o).getUTCDay())) o++;
  return o;
};
/** A meeting time: `hour:minute` Vilnius time on the weekday `offset` days from today. */
const vilnius = (offset: number, hour: number, minute = 0) => {
  const d = dayKey(weekday(offset));
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, 'Europe/Vilnius');
};

const PEOPLE = {
  laura: { firstName: 'Laura', lastName: 'Petrauskas', timeZone: 'Europe/Vilnius', phone: '+37061234567' },
  david: { firstName: 'David', lastName: 'Miller', timeZone: 'America/New_York', phone: '+12125550143' },
  aysel: { firstName: 'Aysel', lastName: 'Mammadova', timeZone: 'Asia/Baku', phone: '+994501234567' },
  jonas: { firstName: 'Jonas', lastName: 'Weber', timeZone: 'Europe/Berlin', phone: '+4915112345678' },
  ruta: { firstName: 'Ruta', lastName: 'Jonaitis', timeZone: 'Europe/Vilnius', phone: null },
} as const;
type Person = keyof typeof PEOPLE;
const emailOf = (p: Person) => `${p}@${DOMAIN}`;

async function remove() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
  const ids = users.map(u => u.id);
  const projects = await prisma.project.deleteMany({
    where: { name: { in: PROJECTS }, members: { every: { userId: { in: ids } } } },
  });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.meeting.deleteMany({ where: { organizerId: { in: ids } } });
  const deleted = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Removed ${deleted.count} demo users and ${projects.count} demo projects.`);
}

async function create() {
  await remove();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const id = {} as Record<Person, string>;
  for (const [key, p] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    const u = await prisma.user.create({
      data: {
        ...p, email: emailOf(key), passwordHash,
        emailVerifiedAt: day(-60), consentAt: day(-60), consentVersion: '1.0',
        createdAt: day(-60),
      },
    });
    id[key] = u.id;
  }

  // ---------- Project 1: international, several time zones ----------
  const p1 = await prisma.project.create({
    data: {
      name: PROJECTS[0]!,
      description: 'EU-funded research project: a platform that plans public transport using live city data. Partners in Vilnius, New York and Baku.',
      startDate: day(-45), endDate: day(110),
      members: {
        create: [
          { userId: id.laura, role: 'MANAGER' as ProjectRole },
          { userId: id.david, role: 'EMPLOYEE' as ProjectRole },
          { userId: id.aysel, role: 'EMPLOYEE' as ProjectRole },
          { userId: id.ruta, role: 'EMPLOYEE' as ProjectRole },
          { userId: id.jonas, role: 'OBSERVER' as ProjectRole },
        ],
      },
    },
  });
  const phase = async (name: string, from: number, to: number, isMilestone = false) =>
    (await prisma.phase.create({ data: { projectId: p1.id, name, startDate: day(from), endDate: day(isMilestone ? from : to), isMilestone } })).id;
  const research = await phase('Research', -45, -12);
  const design = await phase('Design', -11, 18);
  const development = await phase('Development', 19, 80);
  const piloting = await phase('Pilot & evaluation', 81, 105);
  await phase('Final report to the EU', 108, 108, true);

  const activity = async (title: string, phaseId: string, from: number, to: number, status: ActivityStatus, responsible: Person | null, isCritical = false) =>
    (await prisma.activity.create({
      data: { projectId: p1.id, phaseId, title, startDate: day(from), endDate: day(to), status, isCritical, responsibleId: responsible ? id[responsible] : null },
    })).id;
  await activity('Stakeholder interviews', research, -45, -30, 'COMPLETED', 'ruta');
  await activity('Literature review', research, -40, -15, 'COMPLETED', 'aysel');
  await activity('Ethics approval', research, -25, -3, 'DELAYED', 'laura', true);
  const reqs = await activity('Requirements specification', design, -11, 6, 'IN_PROGRESS', 'david', true);
  const ux = await activity('UX prototypes', design, -5, 15, 'IN_PROGRESS', 'ruta');
  await activity('Data model', design, 4, 18, 'PENDING', 'aysel');
  const api = await activity('Routing API', development, 19, 60, 'PENDING', 'david', true);
  await activity('Mobile app', development, 30, 80, 'PENDING', 'ruta');
  await activity('Pilot in Vilnius old town', piloting, 81, 100, 'PENDING', 'laura');
  await activity('Evaluation report', piloting, 95, 105, 'PENDING', 'aysel');

  // ---------- Meetings ----------
  const p1Members: Person[] = ['laura', 'david', 'aysel', 'ruta'];
  const meeting = async (opts: {
    title: string; category: MeetingCategory; start: Date; durationMin: number; status: MeetingStatus;
    people?: Person[]; activityId?: string; description?: string; minutes?: string;
  }) => {
    const people = opts.people ?? p1Members;
    const m = await prisma.meeting.create({
      data: {
        projectId: p1.id, organizerId: id.laura, activityId: opts.activityId ?? null,
        title: opts.title, description: opts.description ?? null, category: opts.category,
        startDate: opts.start, endDate: new Date(opts.start.getTime() + opts.durationMin * 60000),
        durationMin: opts.durationMin, status: opts.status,
        participants: { create: people.map(p => ({ userId: id[p], status: 'ACCEPTED' as const })) },
        polls: { create: [{ startTime: opts.start, endTime: new Date(opts.start.getTime() + opts.durationMin * 60000) }] },
      },
    });
    if (opts.minutes) {
      await prisma.aiDraft.create({ data: { meetingId: m.id, userId: id.laura, draftType: 'SUMMARY', content: opts.minutes } });
    }
    return m.id;
  };

  // 16:00 Vilnius = 09:00 New York = 17:00 Baku: inside everyone's working hours
  await meeting({
    title: 'Project kickoff', category: 'STRATEGIC', start: vilnius(-42, 16), durationMin: 90, status: 'COMPLETED',
    description: 'Goals, roles and the work plan for the first phase.',
    minutes: '## Meeting minutes — Project kickoff\n\n**Decisions**\n- Laura coordinates the project; David leads the routing API.\n- Monthly steering meetings on the first Tuesday.\n\n**Action items**\n- Ruta: schedule stakeholder interviews (2 weeks)\n- Aysel: start the literature review\n- Laura: submit the ethics application',
  });
  await meeting({
    title: 'Research findings review', category: 'REVIEW', start: vilnius(-14, 16), durationMin: 60, status: 'COMPLETED',
    minutes: '## Meeting minutes — Research findings\n\n- 18 stakeholder interviews completed; main need: real-time delay information.\n- Literature review identifies 3 comparable systems (Helsinki, Lyon, Porto).\n\n**Risks**\n- Ethics approval is late; pilot cannot start without it.\n\n**Action items**\n- Laura: follow up with the ethics committee this week',
  });
  await meeting({
    title: 'Weekly status', category: 'STATUS', start: vilnius(-7, 16, 30), durationMin: 30, status: 'COMPLETED',
    people: ['laura', 'david', 'ruta'],
  });
  await meeting({
    title: 'Budget planning for development phase', category: 'PLANNING', start: vilnius(-4, 10), durationMin: 60, status: 'COMPLETED',
    people: ['laura', 'ruta'],
    minutes: '## Meeting minutes — Budget planning\n\n- Development phase budget: 120,000 EUR (60% personnel, 25% cloud, 15% travel).\n- Cloud costs to be reviewed monthly.',
  });
  // Upcoming, confirmed and linked to an activity (moving the activity on the Gantt chart suggests moving it too)
  await meeting({
    title: 'Requirements sign-off', category: 'REVIEW', start: vilnius(3, 16), durationMin: 60, status: 'CONFIRMED',
    activityId: reqs, description: 'Walk through the requirements specification and approve it.',
  });
  await meeting({
    title: 'UX prototype demo', category: 'REVIEW', start: vilnius(8, 16, 30), durationMin: 45, status: 'CONFIRMED',
    activityId: ux, people: ['laura', 'ruta', 'david'],
  });

  // Open poll (Doodle-style): Ruta has voted, others have not yet — 3 YES votes out of 4 confirm it automatically
  const slots = [vilnius(10, 16), vilnius(11, 16), vilnius(12, 15, 30)];
  const poll = await prisma.meeting.create({
    data: {
      projectId: p1.id, organizerId: id.laura, activityId: api, title: 'Routing API architecture', category: 'PLANNING',
      description: 'Choose the architecture for the routing API before development starts.',
      durationMin: 60, status: 'DRAFT',
      participants: { create: p1Members.map(p => ({ userId: id[p] })) },
      polls: { create: slots.map(s => ({ startTime: s, endTime: new Date(s.getTime() + 3600e3) })) },
    },
    include: { polls: { orderBy: { startTime: 'asc' } } },
  });
  for (const [i, vote] of (['YES', 'IF_NECESSARY', 'NO'] as const).entries()) {
    await prisma.pollVote.create({ data: { pollId: poll.polls[i]!.id, userId: id.ruta, vote } });
  }
  for (const [i, vote] of (['YES', 'YES', 'IF_NECESSARY'] as const).entries()) {
    await prisma.pollVote.create({ data: { pollId: poll.polls[i]!.id, userId: id.laura, vote } });
  }

  // ---------- Project 2: Laura is only an employee here (different role per project) ----------
  const p2 = await prisma.project.create({
    data: {
      name: PROJECTS[1]!,
      description: 'Moving the hospital scheduling system to the cloud.',
      startDate: day(-20), endDate: day(60),
      members: { create: [{ userId: id.jonas, role: 'MANAGER' }, { userId: id.laura, role: 'EMPLOYEE' }] },
    },
  });
  const p2phase = await prisma.phase.create({ data: { projectId: p2.id, name: 'Migration', startDate: day(-20), endDate: day(60) } });
  await prisma.activity.createMany({
    data: [
      { projectId: p2.id, phaseId: p2phase.id, title: 'Inventory of current systems', startDate: day(-20), endDate: day(-5), status: 'COMPLETED', responsibleId: id.laura },
      { projectId: p2.id, phaseId: p2phase.id, title: 'Cloud migration plan', startDate: day(-4), endDate: day(14), status: 'IN_PROGRESS', responsibleId: id.jonas },
    ],
  });
  await prisma.meeting.create({
    data: {
      projectId: p2.id, organizerId: id.jonas, title: 'Migration planning', category: 'PLANNING',
      startDate: vilnius(-10, 14), endDate: new Date(vilnius(-10, 14).getTime() + 3600e3), durationMin: 60, status: 'COMPLETED',
      participants: { create: [{ userId: id.jonas }, { userId: id.laura }] },
    },
  });

  // A little audit history, so the logs are not empty
  for (const p of Object.keys(PEOPLE) as Person[]) {
    await prisma.auditLog.create({ data: { userId: id[p], action: 'REGISTER', ipAddress: '127.0.0.1', details: 'Account created; consented to privacy policy v1.0.', createdAt: day(-60) } });
  }
  await prisma.auditLog.create({ data: { userId: id.laura, projectId: p1.id, action: 'PROJECT_CREATED', ipAddress: '127.0.0.1', details: `Created project "${PROJECTS[0]}".`, createdAt: day(-45) } });

  console.log('\nDemo data created.');
  console.log('Log in at http://localhost:5173 with any of these (password: DEMO_PASSWORD from .env, or the default in prisma/demo.ts):');
  console.log(`  ${emailOf('laura')}  — Laura, Vilnius: manager of "${PROJECTS[0]}", employee in "${PROJECTS[1]}"`);
  console.log(`  ${emailOf('david')}  — David, New York: employee (responsible for critical activities)`);
  console.log(`  ${emailOf('aysel')}  — Aysel, Baku: employee`);
  console.log(`  ${emailOf('ruta')}   — Ruta, Vilnius: employee`);
  console.log(`  ${emailOf('jonas')}  — Jonas, Berlin: observer in "${PROJECTS[0]}", manager of "${PROJECTS[1]}"`);
  console.log('\nManagers (Laura, Jonas) must set up two-factor login on first login unless REQUIRE_2FA_FOR_MANAGERS=false.');
}

(process.argv.includes('--remove') ? remove() : create())
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
