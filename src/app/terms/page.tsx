import { EarlyAccessNotice, LegalPage } from "@/components/features/LegalPage";
import { CONTROLLER } from "@/lib/constants/legal";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of use · LogEveryLift" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <EarlyAccessNotice />

      <p>
        These terms are an agreement between you and {CONTROLLER.name} ({CONTROLLER.location}), who runs
        LogEveryLift. By creating an account you accept them and the <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>Early access, as is</h2>
      <ul>
        <li>LogEveryLift is free, and is a hobby project in an early phase run by one person.</li>
        <li>
          There is no guarantee of uptime or availability. The app can be slow, down, changed, paused or shut down at
          any time. If it is shut down for good, we will try to give notice so you can download your data first.
        </li>
        <li>
          Data can be lost through bugs, mistakes or hardware failure, even though backups are taken. Keep your own
          copy with Download My Data if your history matters to you.
        </li>
        <li>
          Security is a reasonable best effort for a small project, without audits or certifications. We still meet
          the security and breach-notification duties the law sets, as described in the privacy policy.
        </li>
        <li>The app is provided as is, without any promise that it is fit for a particular purpose or free of errors.</li>
      </ul>

      <h2>Not medical advice</h2>
      <p>
        Programs, AI-built plans and progression suggestions are general training suggestions, not medical,
        physiotherapy or coaching advice tailored to you. Training carries a risk of injury. You decide what you lift,
        and you train at your own risk. Talk to a doctor before starting if you have a health condition, and stop if
        something hurts.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 13. One account per person, and keep your password to yourself.</li>
        <li>You can delete your account at any time in Account.</li>
        <li>
          We may suspend or delete an account that breaks these terms, for example by abusing other users,
          attacking or overloading the service, scraping it, or putting unlawful or offensive content in names,
          notes, feedback or shared programs.
        </li>
      </ul>

      <h2>Your content</h2>
      <p>
        Your training data is yours. You give us only the permission we need to store it and show it to you and to
        the people you choose to share with, as the privacy policy describes. The app&apos;s source code is open
        source under the Apache 2.0 licence.
      </p>

      <h2>Liability</h2>
      <p>
        As far as Norwegian law allows, we are not liable for lost data, lost training progress, injury or any
        indirect loss arising from using the app. Nothing in these terms limits rights you have under mandatory
        consumer law, or liability for gross negligence or intent.
      </p>

      <h2>Changes and law</h2>
      <p>
        We may change these terms. When a change matters, the date at the top changes and the app tells you. When a
        change adds obligations for you, the app asks you to accept the new version; if you don&apos;t, you can delete
        your account. Norwegian law applies. Questions:{" "}
        <a href={`mailto:${CONTROLLER.email}`}>{CONTROLLER.email}</a>.
      </p>
    </LegalPage>
  );
}
