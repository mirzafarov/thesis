import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  toDay, todayDay, formatDay, formatDayLong, formatMonth, formatWeekday, dayOfMonth, weekdayIndex,
} from './dates';
import './gantt.css';

export interface GanttPhase {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isMilestone: boolean;
}

export interface GanttMeeting {
  id: string;
  title: string;
  startDate: string | null;
  status: string;
}

export interface GanttActivity {
  id: string;
  title: string;
  phaseId: string | null;
  startDate: string | null;
  endDate: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DELAYED';
  isCritical: boolean;
  responsible?: { id: string; firstName: string; lastName: string } | null;
  meetings?: GanttMeeting[];
}

export type GanttItem = { kind: 'phase'; item: GanttPhase } | { kind: 'activity'; item: GanttActivity };

interface Props {
  phases: GanttPhase[];
  activities: GanttActivity[];
  readOnly: boolean;
  /** Called after a drag or keyboard move. Dates are day numbers (inclusive end). */
  onMove: (target: GanttItem, startDay: number, endDay: number) => Promise<void> | void;
  onOpen: (target: GanttItem) => void;
}

type Zoom = 'day' | 'week' | 'month';
const DAY_WIDTH: Record<Zoom, number> = { day: 36, week: 14, month: 4 };
const STATUS_LABEL: Record<GanttActivity['status'], string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  DELAYED: 'Delayed',
};

interface Drag {
  key: string;
  target: GanttItem;
  mode: 'move' | 'start' | 'end';
  pointerX: number;
  origStart: number;
  origEnd: number;
  moved: boolean;
}

interface Preview {
  key: string;
  start: number;
  end: number;
}

const itemKey = (t: GanttItem) => `${t.kind}:${t.item.id}`;

function spanOf(t: GanttItem): [number, number] | null {
  const { startDate, endDate } = t.item;
  if (!startDate) return null;
  const start = toDay(startDate);
  return [start, endDate ? toDay(endDate) : start];
}

const isOverdue = (a: GanttActivity, today: number) =>
  a.status !== 'COMPLETED' && !!a.endDate && toDay(a.endDate) < today;

export default function GanttChart({ phases, activities, readOnly, onMove, onOpen }: Props) {
  const [zoom, setZoom] = useState<Zoom>('day');
  const [preview, setPreviewState] = useState<Preview | null>(null);
  // Mirror of `preview` that is always current, even before React re-renders (used when a drag ends).
  const previewRef = useRef<Preview | null>(null);
  const setPreview = (p: Preview | null) => {
    previewRef.current = p;
    setPreviewState(p);
  };
  const dragRef = useRef<Drag | null>(null);
  const keyTimer = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayDay();
  const dayW = DAY_WIDTH[zoom];

  // Rows: each phase followed by its activities, then activities without a phase.
  const rows = useMemo(() => {
    const result: { type: 'group' | 'item'; label?: string; target?: GanttItem }[] = [];
    for (const phase of phases) {
      result.push({ type: 'item', target: { kind: 'phase', item: phase } });
      for (const a of activities.filter(x => x.phaseId === phase.id)) {
        result.push({ type: 'item', target: { kind: 'activity', item: a } });
      }
    }
    const phaseIds = new Set(phases.map(p => p.id));
    const loose = activities.filter(a => !a.phaseId || !phaseIds.has(a.phaseId));
    if (loose.length > 0) {
      if (phases.length > 0) result.push({ type: 'group', label: 'Not in a phase' });
      for (const a of loose) result.push({ type: 'item', target: { kind: 'activity', item: a } });
    }
    return result;
  }, [phases, activities]);

  // Visible range: everything dated, plus today, with some padding; starts on a Monday.
  const [rangeStart, rangeEnd] = useMemo(() => {
    let min = today;
    let max = today;
    for (const r of rows) {
      const span = r.target && spanOf(r.target);
      if (span) {
        min = Math.min(min, span[0]);
        max = Math.max(max, span[1]);
      }
    }
    min -= 7;
    min -= weekdayIndex(min);
    max = Math.max(max + 14, min + 42);
    return [min, max];
  }, [rows, today]);

  const totalDays = rangeEnd - rangeStart + 1;
  const width = totalDays * dayW;
  const x = (day: number) => (day - rangeStart) * dayW;

  // Scroll so today is visible when the chart first appears or the zoom changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, x(today) - el.clientWidth / 3);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps -- only re-center on zoom changes

  // Header cells
  const months = useMemo(() => {
    // Split the range wherever a new month begins.
    const out: { start: number; end: number }[] = [];
    let start = rangeStart;
    for (let d = rangeStart + 1; d <= rangeEnd + 1; d++) {
      if (d > rangeEnd || dayOfMonth(d) === 1) {
        out.push({ start, end: d - 1 });
        start = d;
      }
    }
    return out;
  }, [rangeStart, rangeEnd]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let d = rangeStart; d <= rangeEnd; d++) {
      if (zoom === 'day' || (zoom === 'week' && weekdayIndex(d) === 0) || (zoom === 'month' && dayOfMonth(d) === 1)) out.push(d);
    }
    return out;
  }, [rangeStart, rangeEnd, zoom]);

  // ---------- Dragging ----------

  const currentSpan = (t: GanttItem): [number, number] | null => {
    if (preview && preview.key === itemKey(t)) return [preview.start, preview.end];
    return spanOf(t);
  };

  const beginDrag = (e: ReactPointerEvent, target: GanttItem, mode: Drag['mode']) => {
    if (readOnly || e.button !== 0) return;
    const span = spanOf(target);
    if (!span) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { key: itemKey(target), target, mode, pointerX: e.clientX, origStart: span[0], origEnd: span[1], moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.pointerX;
    if (Math.abs(dx) > 3) drag.moved = true;
    const delta = Math.round(dx / dayW);
    const milestone = drag.target.kind === 'phase' && drag.target.item.isMilestone;
    let start = drag.origStart;
    let end = drag.origEnd;
    if (drag.mode === 'move' || milestone) {
      start += delta;
      end += delta;
    } else if (drag.mode === 'start') {
      start = Math.min(drag.origStart + delta, drag.origEnd);
    } else {
      end = Math.max(drag.origEnd + delta, drag.origStart);
    }
    setPreview({ key: drag.key, start, end });
  };

  const endDrag = async () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved) {
      setPreview(null);
      onOpen(drag.target);
      return;
    }
    const p = previewRef.current;
    if (!p || (p.start === drag.origStart && p.end === drag.origEnd)) {
      setPreview(null);
      return;
    }
    try {
      await onMove(drag.target, p.start, p.end);
    } finally {
      setPreview(null);
    }
  };

  // ---------- Keyboard (WCAG: everything you can drag, you can also do with the keyboard) ----------

  const onBarKeyDown = (e: ReactKeyboardEvent, target: GanttItem) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(target);
      return;
    }
    if (readOnly || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const span = currentSpan(target);
    if (!span) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const milestone = target.kind === 'phase' && target.item.isMilestone;
    let [start, end] = span;
    if (e.shiftKey && !milestone) {
      end = Math.max(start, end + step);
    } else {
      start += step;
      end += step;
    }
    setPreview({ key: itemKey(target), start, end });
    // Save once the user stops pressing keys.
    window.clearTimeout(keyTimer.current);
    keyTimer.current = window.setTimeout(async () => {
      try {
        await onMove(target, start, end);
      } finally {
        setPreview(null);
      }
    }, 600);
  };

  useEffect(() => () => window.clearTimeout(keyTimer.current), []);

  // ---------- Rendering ----------

  const describe = (t: GanttItem, span: [number, number] | null) => {
    const name = t.kind === 'phase' ? `${t.item.isMilestone ? 'Milestone' : 'Phase'} ${t.item.name}` : `Activity ${t.item.title}`;
    const when = span ? (span[0] === span[1] ? formatDayLong(span[0]) : `${formatDayLong(span[0])} to ${formatDayLong(span[1])}`) : 'no dates';
    const status = t.kind === 'activity' ? `, ${STATUS_LABEL[t.item.status]}${isOverdue(t.item, today) ? ', overdue' : ''}` : '';
    const hint = readOnly ? 'Press Enter for details.' : 'Arrow keys move it by a day, Shift plus arrow keys change the end date, Enter edits.';
    return `${name}, ${when}${status}. ${hint}`;
  };

  const renderBar = (t: GanttItem) => {
    const span = currentSpan(t);
    if (!span) {
      return (
        <button type="button" className="gantt-undated" onClick={() => onOpen(t)}>
          No dates yet{readOnly ? '' : ' — click to schedule'}
        </button>
      );
    }
    const [start, end] = span;
    const left = x(start);
    const barWidth = (end - start + 1) * dayW;
    const common = {
      role: 'button',
      tabIndex: 0,
      'aria-label': describe(t, span),
      title: `${t.kind === 'phase' ? t.item.name : t.item.title}: ${start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`}`,
      onPointerDown: (e: ReactPointerEvent) => beginDrag(e, t, 'move'),
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: () => { dragRef.current = null; setPreview(null); },
      onKeyDown: (e: ReactKeyboardEvent) => onBarKeyDown(e, t),
      // Clicks are handled in endDrag; this keeps mouse-less "click" (e.g. screen readers) working.
      onClick: (e: ReactMouseEvent) => { if (e.detail === 0) onOpen(t); },
    };

    if (t.kind === 'phase' && t.item.isMilestone) {
      return (
        <div {...common} className={`gantt-milestone${readOnly ? '' : ' draggable'}`} style={{ left: left + dayW / 2 - 9 }}>
          <span className="gantt-milestone-label">{t.item.name}</span>
        </div>
      );
    }

    const handles = !readOnly && (
      <>
        <span className="gantt-handle start" aria-hidden="true" onPointerDown={e => beginDrag(e, t, 'start')} onPointerMove={onPointerMove} onPointerUp={endDrag} />
        <span className="gantt-handle end" aria-hidden="true" onPointerDown={e => beginDrag(e, t, 'end')} onPointerMove={onPointerMove} onPointerUp={endDrag} />
      </>
    );

    if (t.kind === 'phase') {
      return (
        <div {...common} className={`gantt-bar phase${readOnly ? '' : ' draggable'}`} style={{ left, width: barWidth }}>
          {handles}
        </div>
      );
    }

    const a = t.item;
    const overdue = isOverdue(a, today);
    return (
      <div
        {...common}
        className={`gantt-bar activity status-${a.status.toLowerCase()}${overdue ? ' overdue' : ''}${readOnly ? '' : ' draggable'}`}
        style={{ left, width: barWidth }}
      >
        {barWidth > 60 && <span className="gantt-bar-text">{a.title}</span>}
        {handles}
      </div>
    );
  };

  const renderMeetings = (a: GanttActivity) =>
    (a.meetings || [])
      .filter(m => m.startDate)
      .map(m => {
        const day = toDay(m.startDate!);
        if (day < rangeStart || day > rangeEnd) return null;
        return (
          <span
            key={m.id}
            className="gantt-meeting"
            style={{ left: x(day) + dayW / 2 - 6 }}
            title={`Meeting: ${m.title} — ${new Date(m.startDate!).toLocaleString()}`}
            aria-label={`Meeting ${m.title} on ${new Date(m.startDate!).toLocaleString()}`}
            role="img"
          >
            <i className="bi bi-people-fill" aria-hidden="true" />
          </span>
        );
      });

  const weekendShading = zoom === 'day'
    ? `repeating-linear-gradient(90deg, transparent 0 ${dayW * 5}px, var(--gantt-weekend) ${dayW * 5}px ${dayW * 7}px)`
    : 'none';
  const weekendOffset = x(rangeStart - weekdayIndex(rangeStart));

  return (
    <div className="gantt">
      <div className="gantt-toolbar">
        <div className="btn-group btn-group-sm" role="group" aria-label="Zoom">
          {(['day', 'week', 'month'] as Zoom[]).map(z => (
            <button key={z} type="button" className={`btn ${zoom === z ? 'btn-primary' : 'btn-outline-secondary'}`} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
              {z[0]!.toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => { const el = scrollRef.current; if (el) el.scrollLeft = Math.max(0, x(today) - el.clientWidth / 3); }}
        >
          <i className="bi bi-crosshair me-1" aria-hidden="true" />Today
        </button>
        {!readOnly && <span className="gantt-hint d-none d-md-inline">Drag bars to move them, or drag their edges to change dates.</span>}
      </div>

      <div className="gantt-scroll" ref={scrollRef}>
        <div className="gantt-inner" style={{ width: width + 240 }}>
          {/* Header */}
          <div className="gantt-row gantt-header">
            <div className="gantt-label gantt-corner">Phase / activity</div>
            <div className="gantt-track" style={{ width }}>
              <div className="gantt-months">
                {months.map(m => (
                  <div key={m.start} className="gantt-month" style={{ left: x(m.start), width: (m.end - m.start + 1) * dayW }}>
                    {(m.end - m.start + 1) * dayW > 70 ? formatMonth(m.start) : ''}
                  </div>
                ))}
              </div>
              <div className="gantt-ticks">
                {zoom !== 'month' && ticks.map(d => (
                  <div key={d} className={`gantt-tick${d === today ? ' today' : ''}${weekdayIndex(d) >= 5 ? ' weekend' : ''}`} style={{ left: x(d), width: zoom === 'day' ? dayW : dayW * 7 }}>
                    {zoom === 'day' ? (
                      <>
                        <span className="wd">{formatWeekday(d)}</span>
                        <span>{dayOfMonth(d)}</span>
                      </>
                    ) : formatDay(d)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Body */}
          {rows.length === 0 && (
            <div className="gantt-empty">No phases or activities yet.{readOnly ? '' : ' Add a phase or an activity to see it here.'}</div>
          )}
          {rows.map((r, i) => {
            if (r.type === 'group') {
              return (
                <div key={`g${i}`} className="gantt-row gantt-group">
                  <div className="gantt-label">{r.label}</div>
                  <div className="gantt-track" style={{ width }} />
                </div>
              );
            }
            const t = r.target!;
            const isPhase = t.kind === 'phase';
            const overdue = t.kind === 'activity' && isOverdue(t.item, today);
            return (
              <div key={itemKey(t)} className={`gantt-row${isPhase ? ' is-phase' : ''}`}>
                <div className="gantt-label">
                  <button type="button" className="gantt-label-btn" onClick={() => onOpen(t)} title="Open details">
                    {isPhase ? (
                      <i className={`bi ${t.item.isMilestone ? 'bi-diamond-fill' : 'bi-flag-fill'} me-2`} aria-hidden="true" />
                    ) : (
                      <span className={`gantt-dot status-${t.item.status.toLowerCase()}`} aria-hidden="true" />
                    )}
                    <span className="text-truncate">{isPhase ? t.item.name : t.item.title}</span>
                  </button>
                  {t.kind === 'activity' && t.item.isCritical && (
                    <span className="badge rounded-pill text-bg-danger ms-1" title="Critical activity">Critical</span>
                  )}
                  {overdue && <span className="badge rounded-pill text-bg-warning ms-1">Overdue</span>}
                </div>
                <div className="gantt-track" style={{ width, backgroundImage: weekendShading, backgroundPosition: `${weekendOffset}px 0` }}>
                  {today >= rangeStart && today <= rangeEnd && <div className="gantt-today" style={{ left: x(today) + dayW / 2 }} aria-hidden="true" />}
                  {renderBar(t)}
                  {t.kind === 'activity' && renderMeetings(t.item)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="gantt-legend" aria-label="Legend">
        <span><span className="gantt-swatch phase" /> Phase</span>
        <span><i className="bi bi-diamond-fill text-primary" aria-hidden="true" /> Milestone</span>
        <span><span className="gantt-swatch status-pending" /> Pending</span>
        <span><span className="gantt-swatch status-in_progress" /> In progress</span>
        <span><span className="gantt-swatch status-completed" /> Completed</span>
        <span><span className="gantt-swatch status-delayed" /> Delayed</span>
        <span><span className="gantt-swatch overdue" /> Overdue</span>
        <span><i className="bi bi-people-fill" aria-hidden="true" /> Meeting</span>
        <span><span className="gantt-swatch today" /> Today</span>
      </div>
    </div>
  );
}
