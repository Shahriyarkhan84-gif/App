import { Bullets, H, LegalPage, P } from '@/components/LegalPage';

// Public URL for the Google Play "Delete account URL" field: https://<your-domain>/account-deletion
export default function AccountDeletionPage() {
  return (
    <LegalPage title="Delete your Zynalive account" updated="24 September 2026">
      <H>In the app</H>
      <Bullets items={['Open Zynalive and sign in.', 'Go to Me → Delete account.', 'Type DELETE and confirm. Deletion happens immediately.']} />
      <H>Without the app</H>
      <P>Email [SUPPORT EMAIL] from the address on your account with the subject “Delete my account” and your 11-digit Zynalive ID. We delete the account within 30 days and confirm by email.</P>
      <H>What we delete</H>
      <Bullets items={['Name, username, photo, bio, email and country', 'Followers, following and blocks', 'Direct messages and notifications', 'Live chat messages (replaced with “[deleted]”)', 'Your sign-in account']} />
      <H>What we keep, and why</H>
      <Bullets items={[
        'Coin purchase, gift, earnings and payout records — required for accounting and tax law, kept for [RETENTION PERIOD].',
        'Reports and moderation history — to prevent abuse, kept for [RETENTION PERIOD].',
        'Host identity-verification documents are held by our verification partner Didit under its retention policy.',
      ]} />
      <P>Unused coins and unpaid earnings are lost when you delete your account. If you have a withdrawal in progress, you can delete once it has been paid or rejected.</P>
    </LegalPage>
  );
}
