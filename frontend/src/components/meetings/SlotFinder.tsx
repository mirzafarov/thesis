import { useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Col, Form, ListGroup, Row, Spinner } from 'react-bootstrap';
import axios from 'axios';
import { browserTimeZone, formatInZone, zoneCity } from '../../lib/time';

interface SuggestedSlot {
  start: string;
  end: string;
  best: boolean;
  localTimes: { userId: string; name: string; timeZone: string; label: string }[];
}

interface SearchResult {
  slots: SuggestedSlot[];
  stats: { checked: number; outsideHours: number; busy: number };
  participants: { id: string; name: string; timeZone: string; timeZoneSet: boolean; workdayStart: number; workdayEnd: number; calendarConnected: boolean }[];
}

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

interface Props {
  projectId: string;
  durationMin: number;
  participantIds: string[];
  selected: string[];
  onToggle: (iso: string) => void;
  maxSelected: number;
}

/** Finds the 3–5 best times when every participant is free and inside their working hours. */
const SlotFinder = ({ projectId, durationMin, participantIds, selected, onToggle, maxSelected }: Props) => {
  const today = new Date();
  const [mode, setMode] = useState<'range' | 'day'>('range');
  const [day, setDay] = useState(dateKey(addDays(today, 1)));
  const [startDate, setStartDate] = useState(dateKey(today));
  const [endDate, setEndDate] = useState(dateKey(addDays(today, 7)));
  const [useWindow, setUseWindow] = useState(false);
  const [fromHour, setFromHour] = useState(9);
  const [toHour, setToHour] = useState(13);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const myZone = browserTimeZone();

  const search = async () => {
    if (!projectId) return setError('Choose a project first: its members are the participants.');
    setError('');
    setBusy(true);
    try {
      const res = await axios.post('/api/calendar/suggest', {
        projectId,
        participantIds,
        durationMin,
        mode,
        ...(mode === 'day' ? { date: day } : { startDate, endDate }),
        ...(useWindow ? { fromHour, toHour } : {}),
        count: 5,
      });
      setResult(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not search for free times.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const hours = Array.from({ length: 25 }, (_, h) => h);
  const noSlotsReason = (r: SearchResult) => {
    if (r.stats.checked === 0) return 'The chosen period is already over.';
    if (r.stats.outsideHours === r.stats.checked) {
      return "There is no time in this period when everyone is within their working hours (Monday–Friday, in their own time zone). Their working days don't overlap — try another day, or ask someone to adjust their working hours in Settings.";
    }
    return 'Everyone is busy at all the times that fit their working hours. Try a longer period or a shorter meeting.';
  };

  return (
    <div className="border rounded p-3 mb-3" style={{ borderColor: 'var(--border)' }}>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <strong><i className="bi bi-magic me-1" aria-hidden="true"></i>Find the best times</strong>
        <ButtonGroup size="sm" aria-label="Search mode">
          <Button variant={mode === 'range' ? 'primary' : 'outline-secondary'} aria-pressed={mode === 'range'} onClick={() => setMode('range')}>Several days</Button>
          <Button variant={mode === 'day' ? 'primary' : 'outline-secondary'} aria-pressed={mode === 'day'} onClick={() => setMode('day')}>One day</Button>
        </ButtonGroup>
      </div>

      <Row className="g-2 align-items-end">
        {mode === 'day' ? (
          <Col sm={6}>
            <Form.Label className="small mb-1" htmlFor="sf-day">Day</Form.Label>
            <Form.Control id="sf-day" type="date" size="sm" min={dateKey(today)} value={day} onChange={e => setDay(e.target.value)} />
          </Col>
        ) : (
          <>
            <Col xs={6}>
              <Form.Label className="small mb-1" htmlFor="sf-from">From</Form.Label>
              <Form.Control id="sf-from" type="date" size="sm" min={dateKey(today)} value={startDate} onChange={e => setStartDate(e.target.value)} />
            </Col>
            <Col xs={6}>
              <Form.Label className="small mb-1" htmlFor="sf-to">To</Form.Label>
              <Form.Control id="sf-to" type="date" size="sm" min={startDate} value={endDate} onChange={e => setEndDate(e.target.value)} />
            </Col>
          </>
        )}
      </Row>

      <Form.Check
        id="sf-window"
        className="mt-2 small"
        type="switch"
        label="Only between certain hours (my time)"
        checked={useWindow}
        onChange={e => setUseWindow(e.target.checked)}
      />
      {useWindow && (
        <div className="d-flex align-items-center gap-2 mt-1 small">
          <Form.Select size="sm" aria-label="Earliest hour" value={fromHour} onChange={e => setFromHour(Number(e.target.value))} style={{ width: 100 }}>
            {hours.slice(0, 24).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </Form.Select>
          <span>to</span>
          <Form.Select size="sm" aria-label="Latest hour" value={toHour} onChange={e => setToHour(Number(e.target.value))} style={{ width: 100 }}>
            {hours.slice(1).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </Form.Select>
        </div>
      )}

      <Button className="mt-2" size="sm" onClick={search} disabled={busy || !projectId}>
        {busy ? <><Spinner size="sm" animation="border" className="me-1" />Checking calendars…</> : <><i className="bi bi-search me-1" aria-hidden="true"></i>Search</>}
      </Button>

      {error && <Alert variant="danger" className="mt-2 mb-0 py-2 small">{error}</Alert>}

      {result && (
        <div className="mt-3">
          <div className="small mb-2" style={{ color: 'var(--text-secondary)' }}>
            Checked {result.participants.length} participant{result.participants.length === 1 ? '' : 's'}:{' '}
            {result.participants.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ', '}
                {p.name} ({zoneCity(p.timeZone)}, {p.workdayStart}–{p.workdayEnd}
                {p.calendarConnected ? ', Google Calendar' : ''}
                {!p.timeZoneSet ? ', zone not set' : ''})
              </span>
            ))}
          </div>
          {result.slots.length === 0 ? (
            <Alert variant="warning" className="py-2 small mb-0">{noSlotsReason(result)}</Alert>
          ) : (
            <ListGroup>
              {result.slots.map(s => {
                const isSelected = selected.includes(s.start);
                return (
                  <ListGroup.Item key={s.start} className="d-flex justify-content-between align-items-center gap-2">
                    <div>
                      <div className="fw-semibold">
                        {s.best && <Badge bg="success" className="me-2">Best</Badge>}
                        {formatInZone(s.start, myZone)} – {formatInZone(s.end, myZone, { weekday: undefined, day: undefined, month: undefined })}
                      </div>
                      <div className="small" style={{ color: 'var(--text-secondary)' }}>
                        {s.localTimes
                          .filter((l, idx, all) => all.findIndex(x => x.timeZone === l.timeZone) === idx && l.timeZone !== myZone)
                          .map(l => `${l.label.replace(/^\w+, /, '')} for ${zoneCity(l.timeZone)}`)
                          .join(' · ') || 'Same time zone for everyone'}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isSelected ? 'success' : 'outline-primary'}
                      disabled={!isSelected && selected.length >= maxSelected}
                      onClick={() => onToggle(s.start)}
                      aria-pressed={isSelected}
                    >
                      {isSelected ? <><i className="bi bi-check-lg" aria-hidden="true"></i> Added</> : 'Add to poll'}
                    </Button>
                  </ListGroup.Item>
                );
              })}
            </ListGroup>
          )}
        </div>
      )}
    </div>
  );
};

export default SlotFinder;
