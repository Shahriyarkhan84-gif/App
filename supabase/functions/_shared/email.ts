/** Sends a transactional email through Resend. No-op (logged) if not configured. */
export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM') ?? 'Zynalive <hello@zynalive.example>';
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set; skipping email', subject);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) console.error('Resend failed', res.status);
}

const layout = (body: string) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">
  <div style="font-weight:800;color:#7C5CFF;font-size:20px;margin-bottom:24px">Zynalive</div>
  ${body}
  <p style="color:#888;font-size:12px;margin-top:32px">You're receiving this because you have a Zynalive account.</p>
</div>`;

export const emails = {
  welcome: (name: string) => ({
    subject: 'Welcome to Zynalive',
    html: layout(`<h2>Welcome${name ? `, ${escapeHtml(name)}` : ''}!</h2>
      <p>Watch live rooms, chat, send gifts — or tap <b>Create</b> to go live yourself.</p>`),
  }),
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
