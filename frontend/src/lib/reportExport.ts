// PDF and Excel export of a report. Libraries are loaded only when exporting (keeps the app fast).

/** Selected phases for the PDF header line (shortened so the line fits the page). */
const phaseLabel = (r: ReportData) => {
  const names = r.filters.phaseNames ?? [];
  const text = names.join(', ');
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

export interface ReportData {
  period: { from: string; to: string; timeZone: string };
  filters: { category: string; phaseNames?: string[] };
  generatedAt: string;
  months: string[];
  totals: { meetings: number; meetingHours: number; personHours: number; people: number; projects: number };
  projects: {
    id: string; name: string; yourRole: string; fullAccess: boolean; meetings: number; meetingHours: number; personHours: number;
    withMinutes: number; openPolls: number;
    activities: { total: number; completed: number; inProgress: number; pending: number; delayed: number };
    byCategory: Record<string, number>;
  }[];
  people: { id: string; name: string; email: string; meetings: number; hours: number; byMonth: Record<string, number> }[];
  meetings: { id: string; title: string; project: string; category: string; start: string; durationMin: number; status: string; participants: string[]; minutes: string | null }[];
  activities: { project: string; phase: string | null; title: string; responsible: string | null; status: string; isCritical: boolean; startDate: string | null; endDate: string | null }[];
}

export const CATEGORY_LABEL: Record<string, string> = {
  ALL: 'All types', STRATEGIC: 'Strategic', PLANNING: 'Planning', REVIEW: 'Review', STATUS: 'Status update', OTHER: 'Other',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', DELAYED: 'Delayed',
  CONFIRMED: 'Confirmed', CALENDAR_SYNCHRONIZED: 'Confirmed (in calendar)', RESCHEDULED: 'Moved',
};

const fmtDateTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';
export const monthLabel = (key: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`));
const fileBase = (r: ReportData) => `SafeZone_Report_${r.period.from}_to_${r.period.to}`;
const stripMarkdown = (s: string) => s.replace(/[#*_`>]/g, '').replace(/\n{2,}/g, '\n').trim();

// ---------- PDF ----------

export async function exportPdf(r: ReportData, scopeLabel: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const blue: [number, number, number] = [37, 99, 235];
  const navy: [number, number, number] = [15, 23, 42];

  // Header with the company logo (hexagon mark + name)
  const header = () => {
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageW, 22, 'F');
    const cx = 18, cy = 11, rad = 6;
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)] as [number, number];
    });
    doc.setFillColor(...blue);
    doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i]![0], p[1] - pts[i]![1]]), pts[0]![0], pts[0]![1], [1, 1], 'F', true);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Safe', 28, 13.5);
    doc.setTextColor(...blue);
    doc.text('Zone', 28 + doc.getTextWidth('Safe '), 13.5);
    doc.setTextColor(200, 210, 225);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Project Meeting Scheduling and Management Platform', pageW - 12, 13, { align: 'right' });
  };
  header();

  doc.setTextColor(...navy);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Activity report', 12, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 100, 115);
  doc.text([
    `Period: ${fmtDate(r.period.from + 'T00:00:00Z')} – ${fmtDate(r.period.to + 'T00:00:00Z')} (${r.period.timeZone})`,
    `Projects: ${scopeLabel}   ·   Meeting type: ${CATEGORY_LABEL[r.filters.category] || r.filters.category}${phaseLabel(r) ? `   ·   Phases: ${phaseLabel(r)}` : ''}`,
    `Generated: ${fmtDateTime(r.generatedAt, r.period.timeZone)}`,
  ], 12, 41);

  // Summary boxes
  const boxes: [string, string][] = [
    ['Meetings', String(r.totals.meetings)],
    ['Meeting hours', String(r.totals.meetingHours)],
    ['Person-hours in meetings', String(r.totals.personHours)],
    ['People', String(r.totals.people)],
  ];
  const bw = (pageW - 24 - 3 * 6) / 4;
  boxes.forEach(([label, value], i) => {
    const x = 12 + i * (bw + 6);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, 55, bw, 18, 2, 2, 'FD');
    doc.setTextColor(...navy);
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.text(value, x + 5, 64);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label, x + 5, 70);
  });

  const table = (title: string, head: string[], body: (string | number)[][], startY?: number) => {
    const y = startY ?? ((doc as any).lastAutoTable?.finalY ?? 75) + 12;
    doc.setFontSize(12.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...navy);
    doc.text(title, 12, y);
    autoTable(doc, {
      startY: y + 3,
      head: [head],
      body: body.length ? body : [[{ content: 'No data for this selection', colSpan: head.length, styles: { halign: 'center', textColor: 120 } } as any]],
      margin: { left: 12, right: 12, top: 28 },
      styles: { fontSize: 8.5, cellPadding: 2 },
      headStyles: { fillColor: blue },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawPage: () => header(),
    });
  };

  table('Projects', ['Project', 'Your role', 'Meetings', 'Meeting h', 'Person-h', 'With minutes', 'Open polls', 'Activities done / total', 'Delayed'],
    r.projects.map(p => [p.name, p.yourRole, p.meetings, p.meetingHours, p.personHours, p.withMinutes, p.openPolls, `${p.activities.completed} / ${p.activities.total}`, p.activities.delayed]),
    84);

  table('Time in meetings per person (hours)', ['Person', 'Meetings', ...r.months.map(monthLabel), 'Total h'],
    r.people.map(p => [p.name, p.meetings, ...r.months.map(m => p.byMonth[m] ?? 0), p.hours]));

  table('Meetings', ['Date', 'Meeting', 'Project', 'Type', 'Min', 'Participants', 'Minutes (summary)'],
    r.meetings.map(m => [
      fmtDateTime(m.start, r.period.timeZone), m.title, m.project, CATEGORY_LABEL[m.category] || m.category, m.durationMin,
      m.participants.join(', '), m.minutes ? stripMarkdown(m.minutes).slice(0, 300) + (m.minutes.length > 300 ? '…' : '') : '—',
    ]));

  table('Activities', ['Project', 'Phase', 'Activity', 'Responsible', 'Status', 'Start', 'End'],
    r.activities.map(a => [a.project, a.phase ?? '—', a.title + (a.isCritical ? ' (critical)' : ''), a.responsible ?? '—', STATUS_LABEL[a.status] || a.status, fmtDate(a.startDate), fmtDate(a.endDate)]));

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Page ${i} of ${pages}`, pageW - 12, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
  }
  doc.save(`${fileBase(r)}.pdf`);
}

// ---------- Excel ----------

export async function exportXlsx(r: ReportData, scopeLabel: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Safe Zone';
  wb.created = new Date(r.generatedAt);

  const sheet = (name: string, columns: { header: string; key: string; width: number; numFmt?: string }[], rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    rows.forEach(row => ws.addRow(row));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return ws;
  };

  // Summary sheet
  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 30 }, { width: 50 }];
  summary.addRow(['Safe Zone — Activity report']).font = { bold: true, size: 16, color: { argb: 'FF2563EB' } };
  summary.addRow([]);
  ([
    ['Period', `${r.period.from} to ${r.period.to} (${r.period.timeZone})`],
    ['Projects', scopeLabel],
    ['Meeting type', CATEGORY_LABEL[r.filters.category] || r.filters.category],
    ['Project phases', r.filters.phaseNames?.length ? r.filters.phaseNames.join(', ') : 'All phases'],
    ['Generated', new Date(r.generatedAt)],
    [],
    ['Meetings', r.totals.meetings],
    ['Meeting hours', r.totals.meetingHours],
    ['Person-hours in meetings', r.totals.personHours],
    ['People', r.totals.people],
  ] as unknown[][]).forEach(row => {
    const added = summary.addRow(row);
    added.getCell(1).font = { bold: true };
  });

  sheet('Projects', [
    { header: 'Project', key: 'name', width: 32 }, { header: 'Your role', key: 'yourRole', width: 12 },
    { header: 'Meetings', key: 'meetings', width: 10 }, { header: 'Meeting hours', key: 'meetingHours', width: 14 },
    { header: 'Person-hours', key: 'personHours', width: 13 }, { header: 'With minutes', key: 'withMinutes', width: 13 },
    { header: 'Open polls', key: 'openPolls', width: 11 }, { header: 'Activities', key: 'total', width: 11 },
    { header: 'Completed', key: 'completed', width: 11 }, { header: 'In progress', key: 'inProgress', width: 11 },
    { header: 'Pending', key: 'pending', width: 10 }, { header: 'Delayed', key: 'delayed', width: 10 },
    { header: 'Strategic', key: 'STRATEGIC', width: 10 }, { header: 'Planning', key: 'PLANNING', width: 10 },
    { header: 'Review', key: 'REVIEW', width: 9 }, { header: 'Status', key: 'STATUS', width: 9 }, { header: 'Other', key: 'OTHER', width: 9 },
  ], r.projects.map(p => ({ ...p, ...p.activities, ...p.byCategory })));

  const people = sheet('People', [
    { header: 'Person', key: 'name', width: 26 }, { header: 'Email', key: 'email', width: 30 }, { header: 'Meetings', key: 'meetings', width: 10 },
    ...r.months.map(m => ({ header: monthLabel(m), key: m, width: 11, numFmt: '0.0' })),
    { header: 'Total hours', key: 'hours', width: 12, numFmt: '0.0' },
  ], r.people.map(p => ({ ...p, ...Object.fromEntries(r.months.map(m => [m, p.byMonth[m] ?? 0])) })));
  if (r.people.length) {
    const total = people.addRow({ name: 'Total', meetings: r.people.reduce((s, p) => s + p.meetings, 0) });
    const lastRow = r.people.length + 1;
    [...r.months, 'hours'].forEach((key, i) => {
      const col = people.getColumn(4 + i).letter;
      total.getCell(key).value = { formula: `SUM(${col}2:${col}${lastRow})` };
    });
    total.font = { bold: true };
  }

  sheet('Meetings', [
    { header: 'Start', key: 'start', width: 18, numFmt: 'yyyy-mm-dd hh:mm' }, { header: 'Meeting', key: 'title', width: 32 },
    { header: 'Project', key: 'project', width: 26 }, { header: 'Type', key: 'category', width: 14 },
    { header: 'Duration (min)', key: 'durationMin', width: 14 }, { header: 'Status', key: 'status', width: 20 },
    { header: 'Participants', key: 'participants', width: 40 }, { header: 'Minutes (summary)', key: 'minutes', width: 60 },
  ], r.meetings.map(m => ({
    ...m,
    start: new Date(m.start),
    category: CATEGORY_LABEL[m.category] || m.category,
    status: STATUS_LABEL[m.status] || m.status,
    participants: m.participants.join(', '),
    minutes: m.minutes ? stripMarkdown(m.minutes) : '',
  })));

  sheet('Activities', [
    { header: 'Project', key: 'project', width: 26 }, { header: 'Phase', key: 'phase', width: 18 },
    { header: 'Activity', key: 'title', width: 32 }, { header: 'Critical', key: 'critical', width: 9 },
    { header: 'Responsible', key: 'responsible', width: 22 }, { header: 'Status', key: 'status', width: 13 },
    { header: 'Start', key: 'startDate', width: 12, numFmt: 'yyyy-mm-dd' }, { header: 'End', key: 'endDate', width: 12, numFmt: 'yyyy-mm-dd' },
  ], r.activities.map(a => ({
    ...a,
    critical: a.isCritical ? 'Yes' : '',
    status: STATUS_LABEL[a.status] || a.status,
    startDate: a.startDate ? new Date(a.startDate) : null,
    endDate: a.endDate ? new Date(a.endDate) : null,
  })));

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBase(r)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
