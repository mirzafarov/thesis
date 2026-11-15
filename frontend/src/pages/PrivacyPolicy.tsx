// Privacy policy (GDPR art. 13): what personal data Safe Zone processes, why, on which legal basis, who receives it,
// how long it is kept, how it is protected and which rights users have. Public page, linked from the sign-up consent.
// The version number comes from the server (Admin settings → privacy policy version) and is stored with every consent.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import BrandLogo from '../components/BrandLogo';
import './landing.css';

/** Who is responsible for the data (the "controller"). Add a contact email before real use. */
const CONTROLLER = {
  name: 'Safe Zone, a Bachelor’s thesis project at Vilnius University, Kaunas Faculty',
  email: 'mirzafarovt@gmail.com',
};

const DATA = [
  ['Account', 'First and last name, email address, phone number (optional), personal ID code (optional, encrypted), password (stored only as a bcrypt hash)', 'To create your account, let you log in and show your name to your project colleagues', 'Contract (art. 6(1)(b))'],
  ['Preferences', 'Time zone, working hours, light/dark mode', 'To show times in your zone and suggest meeting times inside working hours', 'Contract'],
  ['Projects and meetings', 'Projects and roles, activities, meeting polls and votes, meetings, video links, to-dos, agendas and confirmations, meeting notes, email group messages, AI drafts', 'The purpose of the service: planning and running project meetings', 'Contract'],
  ['Security', 'Sessions (IP address, browser, times), login attempts, two-factor login settings (secret encrypted, recovery codes hashed), audit log of important actions with IP address', 'To keep accounts safe, detect attacks and show who changed what', 'Legitimate interest in security (art. 6(1)(f))'],
  ['Consent record', 'When you accepted this policy and which version', 'To prove consent, as required by the GDPR', 'Legal obligation (art. 6(1)(c))'],
  ['Google Calendar (if you connect it)', 'Your Google email, access tokens (encrypted); your busy times are read when free slots are searched, but event contents are not stored', 'To find free times and add confirmed meetings to your calendar', 'Consent (you choose to connect; you can disconnect any time)'],
];

const RECIPIENTS = [
  ['Google (Gmail SMTP)', 'Sends Safe Zone emails (confirmations, invitations, reminders, group messages)', 'Your email address and the email content'],
  ['Google Calendar / Google Meet', 'Only if you connect Google: busy times, calendar events and Meet links', 'Meeting title, time, participants'],
  ['Google Gemini', 'Only when you use the AI assistant', 'The meeting details (title, time, participants, agenda, notes, to-dos) and your instructions'],
  ['Jitsi Meet (8x8)', 'Only when you join a Jitsi video call', 'What you share in the call'],
  ['Have I Been Pwned', 'Checks at sign-up and password reset whether a password appeared in known data breaches', 'Only the first 5 characters of a SHA-1 hash of the password; the password itself never leaves Safe Zone'],
];

const RIGHTS = [
  ['Access and portability', 'Settings → “Export My Data” downloads everything about you as a JSON file.'],
  ['Rectification', 'Change your time zone, working hours and ID code in Settings; for your name, email or phone, contact the administrator.'],
  ['Erasure (“right to be forgotten”)', 'Settings → “Delete Account” deletes your account and personal data at once.'],
  ['Withdraw consent', 'Disconnect Google Calendar on the Dashboard; change the Google Fonts choice on the Cookie policy page.'],
  ['Restriction and objection', 'Contact the administrator.'],
  ['Complaint', 'You can complain to the State Data Protection Inspectorate of Lithuania (Valstybinė duomenų apsaugos inspekcija, vdai.lrv.lt).'],
];

const Table = ({ head, rows }: { head: string[]; rows: string[][] }) => (
  <div style={{ overflowX: 'auto', marginBottom: 8 }}>
    <table className="sz-policy-table">
      <thead><tr>{head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r[0]}>{r.map((c, i) => (i === 0 ? <th key={i} scope="row" style={{ color: 'var(--text-primary)', textTransform: 'none', letterSpacing: 0, fontSize: '0.9rem' }}>{c}</th> : <td key={i}>{c}</td>))}</tr>)}</tbody>
    </table>
  </div>
);

export default function PrivacyPolicy() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    axios.get('/api/auth/privacy-version').then(r => setVersion(r.data.version)).catch(() => setVersion(null));
  }, []);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link to="/home" className="lp-logo" aria-label="Safe Zone home"><BrandLogo size={32} /></Link>
          <div className="lp-nav-actions">
            <Link to="/dashboard" className="lp-btn lp-btn-ghost">Back to Safe Zone</Link>
          </div>
        </div>
      </header>

      <main className="lp-container sz-policy" style={{ maxWidth: 900, padding: '40px 16px 64px' }}>
        <h1 className="lp-h2" style={{ textAlign: 'left' }}>Privacy policy</h1>
        <p className="lp-muted">Version {version ?? '…'} · Last updated: November 2026</p>

        <section aria-labelledby="who">
          <h2 id="who" className="lp-h3">1. Who is responsible</h2>
          <p>
            The controller of your personal data is {CONTROLLER.name}.{' '}
            {CONTROLLER.email
              ? <>Contact: <a href={`mailto:${CONTROLLER.email}`}>{CONTROLLER.email}</a>.</>
              : <>For privacy questions, contact the Safe Zone administrator of your organisation.</>}
          </p>
        </section>

        <section aria-labelledby="what">
          <h2 id="what" className="lp-h3">2. What data we process, why, and on which legal basis</h2>
          <p>We only store what is needed to plan and run project meetings (data minimisation). No data is used for advertising, profiling or tracking, and nothing is sold.</p>
          <Table head={['Data', 'What exactly', 'Why', 'Legal basis (GDPR)']} rows={DATA} />
        </section>

        <section aria-labelledby="see">
          <h2 id="see" className="lp-h3">3. Who can see your data inside Safe Zone</h2>
          <ul>
            <li>Members of a project see each other’s names, roles, the project plan and the meetings they are invited to.</li>
            <li>Project managers see their project’s meetings, to-dos, reports and project log, except <strong>private meetings</strong> they are not invited to.</li>
            <li>Administrators manage accounts and security (logins, blocks, settings) but <strong>do not see project content</strong> unless they are added to a project.</li>
            <li>Your personal ID code is shown only to you.</li>
          </ul>
        </section>

        <section aria-labelledby="who-else">
          <h2 id="who-else" className="lp-h3">4. Services outside Safe Zone (processors)</h2>
          <Table head={['Service', 'When and why', 'What it receives']} rows={RECIPIENTS} />
          <p>Some of these providers may process data outside the European Union. They protect such transfers with safeguards required by the GDPR, such as the European Commission’s standard contractual clauses or the EU–US Data Privacy Framework.</p>
        </section>

        <section aria-labelledby="keep">
          <h2 id="keep" className="lp-h3">5. How long we keep data</h2>
          <ul>
            <li><strong>Account and project data:</strong> until you delete your account (or a manager deletes the project).</li>
            <li><strong>Sessions:</strong> end after a period of inactivity and after a maximum time; then they can no longer be used.</li>
            <li><strong>Email links</strong> (confirmation, password reset): valid for 24 hours / 30 minutes and only once.</li>
            <li><strong>Security log:</strong> kept to protect the system. When you delete your account, its entries are unlinked from you, but their text may still mention your name (e.g. “Added Ana Petrauskaitė to the project”).</li>
          </ul>
        </section>

        <section aria-labelledby="protect">
          <h2 id="protect" className="lp-h3">6. How your data is protected</h2>
          <ul>
            <li>Passwords are stored only as bcrypt hashes; weak and leaked passwords are refused.</li>
            <li>Two-factor login, automatic account lock after repeated wrong passwords, and automatic logout after inactivity.</li>
            <li>Encryption at rest (AES-256-GCM) for meeting notes, agendas, group messages, AI drafts, your ID code, two-factor secrets and Google tokens.</li>
            <li>Every request is checked against your role in the project, and important actions are recorded in an audit log.</li>
          </ul>
        </section>

        <section aria-labelledby="rights">
          <h2 id="rights" className="lp-h3">7. Your rights</h2>
          <Table head={['Right', 'How']} rows={RIGHTS} />
        </section>

        <section aria-labelledby="other">
          <h2 id="other" className="lp-h3">8. Cookies, children and changes</h2>
          <p>Safe Zone sets no cookies; what it stores in your browser is explained in the <Link to="/cookies">Cookie policy</Link>. The service is meant for adults working on projects and is not intended for children under 16. If this policy changes in an important way, its version number changes and you are asked to accept it again.</p>
        </section>
      </main>
    </div>
  );
}
