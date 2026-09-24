import { Bullets, H, LegalPage, P } from '@/components/LegalPage';

// Public URL for the store listings' privacy-policy field: https://<your-domain>/privacy
// DRAFT: have it reviewed; replace every [BRACKETED] placeholder before publishing.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="24 September 2026">
      <P>This policy explains what [COMPANY LEGAL NAME] (“Zynalive”, “we”) collects when you use the Zynalive app and website, why, and your choices. Contact: [SUPPORT EMAIL].</P>

      <H>What we collect</H>
      <Bullets items={[
        'Account: email address, name and profile photo from sign-up (email, Google or Apple sign-in).',
        'Profile: username, bio, country, language, your 8-digit Zynalive ID, followers and following.',
        'Content: live video and audio while you broadcast, chat messages, direct messages, gifts and reports.',
        'Purchases and earnings: coin packages bought, gifts sent and received, withdrawal requests and payout details you enter. Card details are handled by Stripe; we never see them.',
        'Host verification: if you apply to host, you give us your name, phone, CNIC number, agency code, photos of your CNIC and a photo of you holding it. The photos and CNIC number are sent to our partner Didit to check; we keep only your name, phone, agency code, the last 4 CNIC digits and the result — never the photos.',
        'Device and usage: app version, device model, crash reports and in-app events (screens viewed, rooms joined, gifts sent).',
      ]} />

      <H>How we use it</H>
      <Bullets items={[
        'To run the service: sign-in, live rooms, chat, gifts, coins and payouts.',
        'Safety: automated and human moderation of chat, rooms and accounts, and fraud prevention on payments.',
        'Recommendations: suggesting live rooms you may like.',
        'Support, service emails, and improving the app.',
      ]} />

      <H>Service providers</H>
      <P>We share data only with providers that process it for us: Clerk (sign-in), Supabase (database and hosting), LiveKit (live video), Stripe (payments), Didit (identity verification), Anthropic (AI moderation, translation and support replies), PostHog (analytics), Sentry (crash reports), Resend (email) and Upstash (rate limiting). Some are outside your country; we use their standard contractual protections.</P>

      <H>What others can see</H>
      <P>Your name, username, photo, bio, Zynalive ID, host badge, follower counts, live streams and live-chat messages are visible to other users. Direct messages are visible only to you and the recipient, and to moderators when reported.</P>

      <H>Retention and deletion</H>
      <P>We keep your data while your account is open. You can delete your account at any time in Me → Delete account, or see /account-deletion. Payment and payout records are kept for [RETENTION PERIOD] as required by law.</P>

      <H>Your rights</H>
      <P>You can access, correct or delete your data, and object to or restrict some processing, by contacting [SUPPORT EMAIL]. You can edit most profile details in the app.</P>

      <H>Children</H>
      <P>Zynalive is not for children under [MINIMUM AGE]. You must be 18 or older to go live, receive gifts or withdraw earnings.</P>

      <H>Changes</H>
      <P>We will post updates here and tell you in the app about important changes.</P>
    </LegalPage>
  );
}
