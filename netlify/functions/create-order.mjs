import { PRICE, base, ppToken, json } from '../lib/shared.mjs';
export const config = { path: '/api/create-order' };
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { qty } = await req.json();
    const n = Math.floor(Number(qty));
    if (!(n >= 1 && n <= 9)) return json({ error: 'bad quantity' }, 400);
    const t = await ppToken();
    const r = await fetch(base() + '/v2/checkout/orders', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ description: 'Lumivo HY300 projector x' + n, amount: { currency_code: 'USD', value: (PRICE * n).toFixed(2) } }],
        payment_source: { paypal: { experience_context: { shipping_preference: 'GET_FROM_FILE', user_action: 'PAY_NOW' } } }
      })
    });
    const d = await r.json();
    return json({ id: d.id }, r.ok ? 200 : 502);
  } catch (e) { console.error(e); return json({ error: 'server error' }, 500); }
};
