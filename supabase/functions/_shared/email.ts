/** Sends a transactional email through Resend. No-op (logged) if not configured. */
export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM') ?? 'Streamly <hello@streamly.example.com>';
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set; skipping email', subject);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) console.error('Resend failed', res.status, await res.text());
}

const layout = (body: string) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">
  <div style="font-weight:900;letter-spacing:3px;color:#E50914;font-size:20px;margin-bottom:24px">STREAMLY</div>
  ${body}
  <p style="color:#888;font-size:12px;margin-top:32px">You're receiving this because you have a Streamly account.</p>
</div>`;

export const emails = {
  welcome: (name: string) => ({
    subject: 'Welcome to Streamly 🍿',
    html: layout(`<h2>Welcome${name ? `, ${escapeHtml(name)}` : ''}!</h2>
      <p>Your account is ready. Start with our free titles, and upgrade to Premium anytime to unlock the full library.</p>`),
  }),
  subscriptionStarted: (renewal: string) => ({
    subject: "You're Premium now ✨",
    html: layout(`<h2>Thanks for subscribing!</h2>
      <p>Every title is now unlocked. Your plan renews on <b>${escapeHtml(renewal)}</b>. You can manage billing anytime from your profile.</p>`),
  }),
  subscriptionCanceled: () => ({
    subject: 'Your Premium membership has ended',
    html: layout(`<h2>We're sorry to see you go</h2>
      <p>Your Premium access has ended. Your watch history and list are saved — resubscribe anytime to pick up where you left off.</p>`),
  }),
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
