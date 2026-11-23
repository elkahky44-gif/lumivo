export const PRICE = 59.99;
export const base = () => process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
export const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
export async function ppToken() {
  const auth = Buffer.from(process.env.PAYPAL_CLIENT_ID + ':' + process.env.PAYPAL_SECRET).toString('base64');
  const r = await fetch(base() + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const d = await r.json();
  if (!d.access_token) throw new Error('PayPal auth failed');
  return d.access_token;
}
export async function notify(subject, text) {
  console.log(subject, '\n', text);
  if (!process.env.RESEND_API_KEY || !process.env.OWNER_EMAIL) return;
  await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Lumivo <onboarding@resend.dev>', to: [process.env.OWNER_EMAIL], subject, text }) }).catch(() => {});
}
