import { brand, U } from '@/lib/brand';
import { Bullets, H, LegalPage, P } from '@/components/LegalPage';

// Public URL for the store listings and sign-up screens: https://zynalive.com/terms
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="7 October 2026">
      <P>These terms are an agreement between you and {brand.name} (“we”) for using the {brand.name} app and website. By creating an account you agree to them. Contact: {brand.supportEmail}.</P>

      <H>Who can use {brand.name}</H>
      <Bullets items={[
        'You must be 18 or older.',
        'One account per person. Keep your sign-in details private; you are responsible for activity on your account.',
        'Hosts must pass identity verification (CNIC and face check) before going live.',
      ]} />

      <H>Community guidelines</H>
      <P>To keep {brand.name} safe, you must not:</P>
      <Bullets items={[
        'Show or share nudity, sexual content, or anything involving minors.',
        'Harass, threaten, bully or spread hate against anyone.',
        'Show violence, self-harm, weapons, drugs or illegal activity.',
        'Scam, spam, impersonate others, or ask users to pay outside the app.',
        'Share other people’s private information without permission.',
      ]} />
      <P>We use automated and human moderation. Breaking these rules can lead to warnings, muted chat, removal from rooms, suspension or a permanent ban. Report anything unsafe from the room, profile or chat menu.</P>

      <H>{U.Spend} and gifts</H>
      <Bullets items={[
        `${U.Spend} are a virtual item for sending gifts in the app. They have no cash value, cannot be transferred between accounts and are not refundable, except where the law requires.`,
        'Gifts are final once sent.',
        `Purchases that are reversed or charged back may remove ${U.spend} and can lead to account restrictions.`,
      ]} />

      <H>Host earnings</H>
      <Bullets items={[
        `Hosts earn ${U.earn} from gifts. ${U.Earn} can be withdrawn at the rate and minimum shown in the app, after verification.`,
        'Recent earnings are held for a short period before they can be withdrawn, to protect against payment disputes.',
        'We review withdrawals and may hold or cancel earnings from fraud, abuse or rule-breaking.',
        'Hosts are responsible for their own taxes.',
      ]} />

      <H>Your content</H>
      <P>You own what you stream and post. You give {brand.name} a licence to host, show and distribute it in the app so the service can work (for example, replays and highlights). You can delete your account at any time in Settings → Delete account.</P>

      <H>Ending your account</H>
      <P>You can stop using {brand.name} and delete your account at any time. We may suspend or close accounts that break these terms.</P>

      <H>Disclaimer</H>
      <P>{brand.name} is provided “as is”. We work to keep it running and safe but cannot promise it will always be available or error-free. To the extent the law allows, we are not liable for indirect losses.</P>

      <H>Changes</H>
      <P>We will post updates here and tell you in the app about important changes. Continuing to use {brand.name} after a change means you accept it.</P>
    </LegalPage>
  );
}
