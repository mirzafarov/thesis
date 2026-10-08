import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database for AI testing...');

  // 1. Create a primary user
  const passwordHash = await bcrypt.hash('togrul123', 10);
  
  const user = await prisma.user.upsert({
    where: { email: 'togrul@test.com' },
    update: {},
    create: {
      email: 'togrul@test.com',
      passwordHash,
      firstName: 'Togrul',
      lastName: 'Admin',
      systemRole: 'USER',
    },
  });

  // Admin User
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@safezone.com' },
    update: { passwordHash: adminPasswordHash, systemRole: 'ADMIN' },
    create: {
      email: 'admin@safezone.com',
      passwordHash: adminPasswordHash,
      firstName: 'System',
      lastName: 'Admin',
      systemRole: 'ADMIN',
    },
  });

  // 2. Create a project
  const project = await prisma.project.create({
    data: {
      name: 'Mobile App Redesign',
      description: 'Overhauling the user interface for the main mobile application to improve user retention.',
      members: {
        create: {
          userId: user.id,
          role: 'MANAGER'
        }
      }
    }
  });

  // 3. Create a CONFIRMED meeting
  await prisma.meeting.create({
    data: {
      projectId: project.id,
      organizerId: user.id,
      title: 'Design Review & Budget Sync',
      description: 'Reviewing the final Figma prototypes and finalizing the engineering budget for Q4.',
      durationMin: 60,
      startDate: new Date(),
      status: 'CONFIRMED',
      participants: {
        create: {
          userId: user.id
        }
      }
    }
  });

  console.log('Seeding complete!');
  console.log('--------------------------------------------------');
  console.log('You can log in with:');
  console.log('Standard User: togrul@test.com / togrul123');
  console.log('Admin User:    admin@safezone.com / admin123');
  console.log('--------------------------------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
