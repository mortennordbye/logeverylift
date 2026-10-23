import { EarlyAccessNotice, LegalPage } from "@/components/features/LegalPage";
import { CONTROLLER } from "@/lib/constants/legal";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy policy · LogEveryLift" };

// Written from docs/privacy/data-inventory.md. Change both together.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <EarlyAccessNotice />

      <h2>Who is responsible</h2>
      <p>
        LogEveryLift is run by {CONTROLLER.name}, a private individual in {CONTROLLER.location}, who is the data
        controller for the personal data described here. Contact:{" "}
        <a href={`mailto:${CONTROLLER.email}`}>{CONTROLLER.email}</a>. There is no company behind the app and no data
        protection officer.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account:</strong> your name, email address and password. The password is stored only as a salted
          scrypt hash.
        </li>
        <li>
          <strong>Profile, if you fill it in:</strong> gender, year of birth, height, body weight, training goals and
          experience level, and your body weight history.
        </li>
        <li>
          <strong>Training:</strong> workouts, sets, reps, weights, durations, distances, heart rate zones, effort
          ratings (RIR/RPE), missed sets, how you felt and your readiness score, personal records, programs, training
          cycles and any notes you write.
        </li>
        <li>
          <strong>AI Setup:</strong> the plans you build, the change you ask for and your answers to check-ins.
        </li>
        <li>
          <strong>Social:</strong> friends, friend requests, nudges, reactions, programs you share and invite links
          you create.
        </li>
        <li>
          <strong>Feedback</strong> you send from the app.
        </li>
        <li>
          <strong>Technical:</strong> for each signed-in device, the IP address and browser user agent, kept with
          the login session. IP addresses also appear in the server log when login or sign-up is rate limited.
        </li>
        <li>
          <strong>Connected AI assistants:</strong> if you connect an assistant such as Claude or ChatGPT through the
          app&apos;s MCP server, the connection and its access tokens.
        </li>
      </ul>
      <p>
        Body weight, heart rate, readiness, how you felt and free-text notes can reveal things about your health.
        We treat all of it as health data under GDPR Article 9 and process it only with your explicit consent, which
        you give when you create your account.
      </p>

      <h2>Why, and on what legal basis</h2>
      <ul>
        <li>
          <strong>Running the app for you</strong> (account, training log, programs, progression suggestions,
          friends): the agreement between us, GDPR Article 6(1)(b), and for health data your explicit consent,
          Article 9(2)(a).
        </li>
        <li>
          <strong>Security</strong> (sessions, rate limiting, stopping abuse): legitimate interest in keeping the
          service and your account safe, Article 6(1)(f).
        </li>
        <li>
          <strong>AI editing in AI Setup:</strong> a separate consent you are asked for before the first use,
          Article 6(1)(a) and 9(2)(a).
        </li>
        <li>
          <strong>Feedback:</strong> legitimate interest in improving the app, Article 6(1)(f).
        </li>
      </ul>
      <p>
        There is no advertising, no analytics, no tracking and no selling or sharing of data for marketing. Your data
        is not used to train AI models by us.
      </p>
      <p>
        Progression suggestions (the weight or reps to try next) are calculated automatically from your logged sets.
        They are training suggestions only and have no legal or similarly significant effect on you.
      </p>

      <h2>Where the data is and who else sees it</h2>
      <p>
        The app and its database run on hardware the controller owns, in Norway. Only the controller has access to
        it. The following services also receive data:
      </p>
      <ul>
        <li>
          <strong>Cloudflare</strong> (USA) sits in front of the site for TLS and protection against attacks. All
          traffic, including your IP address, passes through it. Transfers to the USA rely on the EU-US Data Privacy
          Framework and Cloudflare&apos;s standard contractual clauses.
        </li>
        <li>
          <strong>Google Drive</strong> stores an off-site copy of the backups. The backups are encrypted before they
          leave the server, and Google does not have the key.
        </li>
        <li>
          <strong>OpenRouter and the AI model providers it routes to</strong>, only if you opt in to AI editing. What
          is sent: an age band (not your birth year), gender, goals, experience level, what you picked (training
          days, equipment, session length, muscles to prioritise and joints to spare), the names of the exercises
          available to you including custom ones, the draft plan, and up to 200 characters of the change you typed.
          Your name, email, body weight, weights lifted and training history are not sent. The app uses free models, and providers of free models may
          store requests and use them to train their models. They can be outside the EEA, including the USA. You
          consent to this transfer when you opt in (GDPR Article 49(1)(a)), and you can stop using AI editing at any
          time.
        </li>
      </ul>
      <p>
        <strong>Other users</strong> can find you by your name, or by your full email address if they already know
        it. Your email is never shown to them. Friends see your name and avatar, whether you worked out today (you can
        turn this off in Account), reactions and nudges between you, and programs you share with them.
      </p>
      <p>
        <strong>Support and debugging:</strong> the controller can view the app as a given user to investigate a
        problem. This is used only when needed to fix something, and such a session is marked as one in the
        database.
      </p>
      <p>
        <strong>AI assistants you connect yourself</strong> (MCP) can read and change your profile, body weight,
        programs and cycles. That provider&apos;s own privacy policy applies to what it does with the data. You can
        disconnect at any time.
      </p>
      <p>The &quot;Copy prompt&quot; button in AI Setup only copies text to your clipboard; nothing is sent from our server.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account and everything in it: until you delete your account.</li>
        <li>
          Deleting your account removes it from the live database at once. Encrypted backups are rotated out within
          90 days.
        </li>
        <li>Login sessions, with IP address and user agent: 30 days after last use.</li>
        <li>Server logs: 7 days.</li>
      </ul>

      <h2>On your device</h2>
      <p>
        The app sets one login cookie and one short-lived cache of it, both needed to keep you signed in. It also keeps
        your active workout, rest timers, unsynced changes and display settings in your browser&apos;s local storage,
        and caches pages so the app works offline. All of this is needed for the app to work, so we don&apos;t ask
        for cookie consent. Signing out clears it, apart from your display settings. There are no third-party cookies.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>
          <strong>See and take your data</strong> (access, portability): Account → Download My Data gives you
          everything as a JSON file.
        </li>
        <li>
          <strong>Correct it:</strong> edit your profile, workouts and sets in the app.
        </li>
        <li>
          <strong>Delete it:</strong> Account → Delete Account, or delete single body weight entries and workouts.
        </li>
        <li>
          <strong>Withdraw consent:</strong> for AI editing, turn it off in Account; for health data, delete your
          account. Withdrawing doesn&apos;t affect what was done before.
        </li>
        <li>
          <strong>Object to or restrict processing</strong>, or ask anything about your data: email{" "}
          <a href={`mailto:${CONTROLLER.email}`}>{CONTROLLER.email}</a>. You&apos;ll get an answer within one month.
        </li>
        <li>
          <strong>Complain</strong> to the Norwegian Data Protection Authority,{" "}
          <a href="https://www.datatilsynet.no">Datatilsynet</a>, or the authority where you live.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Traffic is encrypted with TLS, passwords are hashed, every request is checked against your account, and
        backups are encrypted. This is a hobby project, so security is a reasonable best effort without audits or
        certifications. If a breach puts your data at risk, we will tell you and Datatilsynet as the law requires.
      </p>

      <h2>Age</h2>
      <p>You must be at least 13 to use LogEveryLift.</p>

      <h2>Changes</h2>
      <p>
        When this policy changes in a way that matters, the date at the top changes and the app asks you to accept the
        new version. See also the <Link href="/terms">terms of use</Link>.
      </p>
    </LegalPage>
  );
}
