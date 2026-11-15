// Project email groups (similar to Google Groups). Managers create groups and choose their members from the project;
// a message written in Safe Zone is emailed to every member and kept in the group's history (encrypted at rest).
//
// Who may do what:
//  - create / change / delete groups: project managers
//  - see a group and its history: its members and project managers
//  - send a message: members who are not observers, and managers
import express from 'express';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { sendEmail } from '../lib/mailer';
import { emails } from '../lib/emails';
import { open, seal } from '../lib/secureText';
import { authenticate, getMembership } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();
const ALIAS_DOMAIN = 'groups.safezone';
const person = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

const slug = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'group';

/** A unique address label: <project>-<group>@groups.safezone (a number is added when it is taken). */
async function uniqueAlias(projectName: string, groupName: string) {
  const base = `${slug(projectName).slice(0, 20)}-${slug(groupName)}`;
  for (let i = 1; ; i++) {
    const alias = `${i === 1 ? base : `${base}-${i}`}@${ALIAS_DOMAIN}`;
    if (!(await prisma.emailGroup.findUnique({ where: { alias } }))) return alias;
  }
}

/** Only real members of the project can be in its groups. */
async function validMembers(projectId: string, ids: unknown) {
  if (!Array.isArray(ids)) return [];
  const wanted = [...new Set(ids.map(String))];
  const members = await prisma.projectMembership.findMany({ where: { projectId, userId: { in: wanted } }, select: { userId: true } });
  return members.map(m => m.userId);
}

const groupView = (g: any, myId: string) => ({
  id: g.id,
  name: g.name,
  alias: g.alias,
  createdAt: g.createdAt,
  members: g.members.map((m: any) => ({ id: m.user.id, firstName: m.user.firstName, lastName: m.user.lastName })),
  isMember: g.members.some((m: any) => m.userId === myId),
  messages: g._count?.messages ?? 0,
});

// Groups of a project: managers see all, other members see the groups they belong to
router.get('/projects/:projectId/groups', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const membership = await getMembership(userId, req.params.projectId!);
    if (!membership) return res.status(403).json({ error: 'Access denied' });
    const isManager = membership.role === 'MANAGER';
    const groups = await prisma.emailGroup.findMany({
      where: { projectId: req.params.projectId!, ...(isManager ? {} : { members: { some: { userId } } }) },
      include: { members: { include: { user: person } }, _count: { select: { messages: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ groups: groups.map(g => groupView(g, userId)), canManage: isManager });
  } catch (error) {
    console.error('Error loading groups:', error);
    res.status(500).json({ error: 'Failed to load the groups' });
  }
});

// Create a group (managers): body = { name, memberIds }
router.post('/projects/:projectId/groups', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const projectId = req.params.projectId!;
    const membership = await getMembership(userId, projectId);
    if (membership?.role !== 'MANAGER') return res.status(403).json({ error: 'Only project managers can create groups' });
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) return res.status(400).json({ error: 'Give the group a name (up to 80 characters)' });
    const memberIds = await validMembers(projectId, req.body.memberIds);
    if (memberIds.length === 0) return res.status(400).json({ error: 'Choose at least one project member' });

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    const group = await prisma.emailGroup.create({
      data: {
        projectId, name, alias: await uniqueAlias(project!.name, name), createdById: userId,
        members: { create: memberIds.map(id => ({ userId: id })) },
      },
      include: { members: { include: { user: person } }, _count: { select: { messages: true } } },
    });
    await audit(req, { userId, projectId, action: 'GROUP_CREATED', details: `Created the email group "${name}" (${group.alias}) with ${memberIds.length} member(s).` });
    res.status(201).json(groupView(group, userId));
  } catch (error) {
    console.error('Error creating a group:', error);
    res.status(500).json({ error: 'Failed to create the group' });
  }
});

async function groupAccess(groupId: string, userId: string) {
  const group = await prisma.emailGroup.findUnique({
    where: { id: groupId },
    include: { members: { include: { user: person } }, project: { select: { name: true } }, _count: { select: { messages: true } } },
  });
  if (!group) return null;
  const membership = await getMembership(userId, group.projectId);
  const isManager = membership?.role === 'MANAGER';
  const isMember = group.members.some(m => m.userId === userId);
  return {
    group,
    canView: !!membership && (isManager || isMember),
    canManage: !!membership && isManager,
    canSend: !!membership && (isManager || (isMember && membership.role !== 'OBSERVER')),
  };
}

// Rename a group or change its members (managers): body = { name?, memberIds? }
router.put('/groups/:groupId', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const access = await groupAccess(req.params.groupId!, userId);
    if (!access) return res.status(404).json({ error: 'Group not found' });
    if (!access.canManage) return res.status(403).json({ error: 'Only project managers can change groups' });
    const { group } = access;
    const data: { name?: string } = {};
    if ('name' in req.body) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name || name.length > 80) return res.status(400).json({ error: 'Give the group a name (up to 80 characters)' });
      data.name = name;
    }
    let memberIds: string[] | null = null;
    if ('memberIds' in req.body) {
      memberIds = await validMembers(group.projectId, req.body.memberIds);
      if (memberIds.length === 0) return res.status(400).json({ error: 'A group needs at least one member' });
    }
    await prisma.$transaction([
      prisma.emailGroup.update({ where: { id: group.id }, data }),
      ...(memberIds ? [
        prisma.emailGroupMember.deleteMany({ where: { groupId: group.id } }),
        prisma.emailGroupMember.createMany({ data: memberIds.map(id => ({ groupId: group.id, userId: id })) }),
      ] : []),
    ]);
    await audit(req, {
      userId, projectId: group.projectId, action: 'GROUP_UPDATED',
      details: `Changed the email group "${data.name ?? group.name}"${memberIds ? ` (${memberIds.length} member(s))` : ''}.`,
    });
    const updated = (await groupAccess(group.id, userId))!.group;
    res.json(groupView(updated, userId));
  } catch (error) {
    console.error('Error changing a group:', error);
    res.status(500).json({ error: 'Failed to change the group' });
  }
});

router.delete('/groups/:groupId', authenticate, async (req: AuthRequest, res) => {
  try {
    const access = await groupAccess(req.params.groupId!, req.user.userId);
    if (!access) return res.status(404).json({ error: 'Group not found' });
    if (!access.canManage) return res.status(403).json({ error: 'Only project managers can delete groups' });
    await prisma.emailGroup.delete({ where: { id: access.group.id } });
    await audit(req, { userId: req.user.userId, projectId: access.group.projectId, action: 'GROUP_DELETED', details: `Deleted the email group "${access.group.name}" and its history.` });
    res.json({ message: 'Group deleted' });
  } catch (error) {
    console.error('Error deleting a group:', error);
    res.status(500).json({ error: 'Failed to delete the group' });
  }
});

// Message history (newest first)
router.get('/groups/:groupId/messages', authenticate, async (req: AuthRequest, res) => {
  try {
    const access = await groupAccess(req.params.groupId!, req.user.userId);
    if (!access) return res.status(404).json({ error: 'Group not found' });
    if (!access.canView) return res.status(403).json({ error: 'You are not a member of this group' });
    const messages = await prisma.groupMessage.findMany({
      where: { groupId: access.group.id },
      include: { sender: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      canSend: access.canSend,
      messages: messages.map(m => ({ id: m.id, sender: m.sender, subject: open(m.subject), body: open(m.body), recipients: m.recipients, createdAt: m.createdAt })),
    });
  } catch (error) {
    console.error('Error loading group messages:', error);
    res.status(500).json({ error: 'Failed to load the messages' });
  }
});

// Send a message to everyone in the group: body = { subject, body }
router.post('/groups/:groupId/messages', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const access = await groupAccess(req.params.groupId!, userId);
    if (!access) return res.status(404).json({ error: 'Group not found' });
    if (!access.canSend) return res.status(403).json({ error: 'You cannot send messages to this group' });
    const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!subject || subject.length > 200) return res.status(400).json({ error: 'Write a subject (up to 200 characters)' });
    if (!body || body.length > 10000) return res.status(400).json({ error: 'Write a message (up to 10000 characters)' });

    const { group } = access;
    const sender = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    const senderName = `${sender!.firstName} ${sender!.lastName}`;
    const recipients = group.members.filter(m => m.userId !== userId).map(m => m.user);

    const message = await prisma.groupMessage.create({
      data: { groupId: group.id, senderId: userId, subject: seal(subject), body: seal(body), recipients: recipients.length },
    });
    // The message text is confidential: only the subject length / count is logged
    await audit(req, { userId, projectId: group.projectId, action: 'GROUP_MESSAGE_SENT', details: `Sent a message to the group "${group.name}" (${recipients.length} recipient(s)).` });

    // Email everyone in the background (the sender keeps the copy in the history)
    (async () => {
      for (const r of recipients) {
        await sendEmail(emails.groupMessage(r, { groupName: group.name, alias: group.alias, projectName: group.project.name, senderName, subject, body }));
      }
    })().catch(err => console.error('[groups] sending failed:', err));

    res.status(201).json({ id: message.id, sender: { id: userId, ...sender }, subject, body, recipients: recipients.length, createdAt: message.createdAt });
  } catch (error) {
    console.error('Error sending a group message:', error);
    res.status(500).json({ error: 'Failed to send the message' });
  }
});

export default router;
