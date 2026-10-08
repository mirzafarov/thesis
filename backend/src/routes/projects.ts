import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// Get all projects for the logged in user
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    
    const projects = await prisma.project.findMany({
      where: {
        members: {
          some: {
            userId: userId
          }
        }
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true }
            }
          }
        },
        _count: {
          select: { activities: true, meetings: true }
        }
      }
    });

    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Create a new project
router.post('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const { name, description, startDate, endDate } = req.body;

    const project = await prisma.project.create({
      data: {
        name,
        description,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        members: {
          create: {
            userId: userId,
            role: 'MANAGER'
          }
        }
      }
    });

    res.status(201).json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get a specific project with activities
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const projectId = req.params.id;

    // Check if user is member
    const membership = await prisma.projectMembership.findUnique({
      where: {
        userId_projectId: { userId, projectId }
      }
    });

    if (!membership && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        activities: true,
        members: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true }
            }
          }
        }
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Create activity for a project
router.post('/:id/activities', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const projectId = req.params.id;
    const { title, description, startDate, endDate } = req.body;

    // Verify membership
    const membership = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId } }
    });

    if (!membership && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const activity = await prisma.activity.create({
      data: {
        projectId,
        title,
        description,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      }
    });

    res.status(201).json(activity);
  } catch (error) {
    console.error('Error creating activity:', error);
    res.status(500).json({ error: 'Failed to create activity' });
  }
});

// Add a member to a project
router.post('/:id/members', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const projectId = req.params.id;
    const { newMemberUserId, role } = req.body; // role: MANAGER, PARTICIPANT, GUEST

    // Verify current user is a MANAGER of this project
    const membership = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId } }
    });

    if (!membership || membership.role !== 'MANAGER') {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only project managers can add members' });
      }
    }

    // Add new member
    const newMember = await prisma.projectMembership.create({
      data: {
        userId: newMemberUserId,
        projectId,
        role: role || 'PARTICIPANT'
      }
    });

    res.status(201).json(newMember);
  } catch (error: any) {
    console.error('Error adding member:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'User is already a member of this project' });
    }
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Delete an activity
router.delete('/:projectId/activities/:activityId', authenticate, async (req: any, res: any) => {
  try {
    const { activityId } = req.params;
    await prisma.activity.delete({
      where: { id: activityId }
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});



// Update an activity status
router.put('/:projectId/activities/:activityId', authenticate, async (req: any, res: any) => {
  try {
    const { activityId } = req.params;
    const { status } = req.body;
    const activity = await prisma.activity.update({
      where: { id: activityId },
      data: { status }
    });
    res.json(activity);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});


// Remove a member from a project
router.delete('/:projectId/members/:userIdToRemove', authenticate, async (req: any, res: any) => {
  try {
    const { projectId, userIdToRemove } = req.params;
    const userId = req.user.userId;
    const membership = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId } }
    });
    if (!membership || membership.role !== 'MANAGER') {
      if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Only managers can remove members' });
    }
    await prisma.projectMembership.delete({
      where: { userId_projectId: { userId: userIdToRemove, projectId } }
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});


  // Delete Project
  router.delete('/:id', authenticate, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const membership = await prisma.projectMembership.findUnique({
        where: { userId_projectId: { userId, projectId: id } }
      });
      if (!membership || membership.role !== 'MANAGER') {
        if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Only managers can delete a project' });
      }
      await prisma.project.delete({
        where: { id }
      });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  });

// Edit Project
router.put('/:id', authenticate, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { name, description } = req.body;
    const membership = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId: id } }
    });
    if (!membership || membership.role !== 'MANAGER') {
      if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Only managers can edit project details' });
    }
    const project = await prisma.project.update({
      where: { id },
      data: { name, description }
    });
    res.json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});


export default router;
