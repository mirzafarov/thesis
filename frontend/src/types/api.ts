// Shapes of the data the Safe Zone API sends, so pages are type-checked instead of using `any`.
// Dates arrive as ISO strings in JSON.

export interface PersonName { id: string; firstName: string; lastName: string }
export interface PersonWithZone extends PersonName { timeZone?: string | null }

export type MeetingStatus =
  | 'DRAFT' | 'AVAILABILITY_SEARCH' | 'SLOT_SUGGESTED' | 'POLL_CREATED' | 'VOTING_IN_PROGRESS'
  | 'CONFIRMED' | 'CALENDAR_SYNCHRONIZED' | 'IN_PROGRESS' | 'RESCHEDULED' | 'COMPLETED' | 'CANCELLED';
export type MeetingCategory = 'STRATEGIC' | 'PLANNING' | 'REVIEW' | 'STATUS' | 'OTHER';

export interface MeetingParticipant { userId: string; status?: string; user: PersonWithZone }

export interface PollTally { start: string; yes: number; ifNecessary: number; no: number }

/** A meeting as listed by GET /api/meetings */
export interface Meeting {
  id: string;
  projectId: string;
  activityId: string | null;
  organizerId: string;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  durationMin: number;
  category: MeetingCategory;
  status: MeetingStatus;
  videoProvider: string | null;
  videoUrl: string | null;
  isPrivate: boolean;
  notesOpen: boolean;
  project: { id: string; name: string };
  organizer: PersonName;
  participants: MeetingParticipant[];
  poll: { options: string[]; tallies: PollTally[]; voted: number; majority: number };
  todos: { total: number; done: number };
}

/** An invitation waiting for the user's vote (GET /api/meetings/polls/pending) */
export interface PendingPoll {
  id: string;
  options: string[];
  meeting: {
    id: string;
    title: string;
    description: string | null;
    durationMin: number;
    project: { name: string };
    participants: { user: { id: string; timeZone: string | null } }[];
  };
}

export interface ProjectMember {
  userId: string;
  role: 'MANAGER' | 'EMPLOYEE' | 'OBSERVER';
  user: { id: string; firstName: string; lastName: string; email: string; timeZone?: string | null };
}

/** A project as listed by GET /api/projects */
export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  members: ProjectMember[];
  activities: { id: string; title: string }[];
  _count?: { activities: number; meetings: number };
}

/** An open to-do assigned to the user (GET /api/action-items/mine) */
export interface MyTodo {
  id: string;
  title: string;
  dueDate: string | null;
  doneAt: string | null;
  meeting: { id: string; title: string; project: { name: string } };
}

/** Logged-in user data returned by login (token + user) */
export interface LoginResponse {
  token: string;
  user: { id: string; email: string; firstName: string; lastName: string; role: string; [key: string]: unknown };
  mfaRequired?: boolean;
  mfaToken?: string;
}
