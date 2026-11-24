// Store backend for Cloudflare Pages. Every function takes `env` (the project's
// Variables and Secrets) instead of reading process.env.
export const PRICE = 59.99;
const CJ = 'https://developers.cjdropshipping.com/api2.0/v1/';
const base = (env) => env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
export const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

async function ppToken(env) {
  const auth = btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_SECRET);
  const r = await fetch(base(env) + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const d = await r.json();
  if (!d.access_token) throw new Error('PayPal auth failed');
  return d.access_token;
}

// Emails the store owner. Returns a short status so test mode can show whether it worked.
async function notify(env, subject, text) {
  console.log(subject, '\n', text);
  if (!env.RESEND_API_KEY || !env.OWNER_EMAIL) return 'email skipped: RESEND_API_KEY or OWNER_EMAIL not set';
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Lumivo Orders <onboarding@resend.dev>', to: [env.OWNER_EMAIL], subject, text }) });
    if (r.ok) return 'email sent';
    const d = await r.json().catch(() => ({}));
    console.error('Resend failed', r.status, JSON.stringify(d));
    return 'email failed: ' + r.status + ' ' + (d.message || '');
  } catch (e) { console.error('Resend error', e); return 'email failed: ' + e.message; }
}

let cached = null; // CJ limits how often a token can be requested, so reuse it while this instance is warm
async function cjToken(env) {
  if (cached && cached.until > Date.now()) return cached.token;
  const tk = await (await fetch(CJ + 'authentication/getAccessToken', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: env.CJ_API_KEY }) })).json();
  if (!tk.data?.accessToken) throw new Error('CJ login failed: ' + tk.message);
  cached = { token: tk.data.accessToken, until: Date.now() + 12 * 3600e3 };
  return cached.token;
}

// Finds the US-plug variant of the product, so the order matches what the store sells.
async function usVariant(env, token) {
  const sku = env.CJ_PRODUCT_SKU || 'CJYD273577104DW';
  const get = async (path) => (await fetch(CJ + path, { headers: { 'CJ-Access-Token': token } })).json();
  const asList = (d) => Array.isArray(d) ? d : (d?.variants || d?.list || []);
  const tried = [];
  let vs = [];
  const q = encodeURIComponent(sku);
  for (const path of ['product/variant/query?productSku=' + q, 'product/query?productSku=' + q]) {
    const r = await get(path); vs = asList(r.data); tried.push(path.split('?')[0] + ': ' + (vs.length ? vs.length + ' variants' : r.message));
    if (vs.length) break;
  }
  if (!vs.length) {
    const r = await get('product/listV2?keyWord=' + q + '&page=1&size=20');
    const items = (r.data?.content || []).flatMap((c) => c.productList || []);
    const hit = items.find((i) => i.sku === sku || i.spu === sku) || (items.length === 1 ? items[0] : null);
    tried.push('listV2: ' + (hit ? 'found ' + hit.id : items.length + ' results, ' + r.message));
    if (hit) { const v = await get('product/variant/query?pid=' + encodeURIComponent(hit.id)); vs = asList(v.data); tried.push('variants by pid: ' + (vs.length || v.message)); }
  }
  const label = (v) => [v.variantKey, v.variantNameEn, v.variantSku].filter(Boolean).join(' / ');
  const us = vs.filter((v) => /(^|[^a-z])us([^a-z]|$)/i.test(label(v)));
  if (us.length !== 1) throw new Error(vs.length
    ? 'Could not pick the US-plug variant. Set CJ_VID to one of: ' + vs.map((v) => v.vid + ' = ' + label(v)).join('; ')
    : 'CJ could not find product ' + sku + ' (' + tried.join(' | ') + ')');
  return us[0].vid;
}

function countryName(cc) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc); }
  catch { return cc === 'US' ? 'United States' : cc; }
}

export function config(env) {
  return json({ id: env.PAYPAL_CLIENT_ID || '' });
}

export async function createOrder(req, env) {
  try {
    const { qty } = await req.json();
    const n = Math.floor(Number(qty));
    if (!(n >= 1 && n <= 9)) return json({ error: 'bad quantity' }, 400);
    const t = await ppToken(env);
    const r = await fetch(base(env) + '/v2/checkout/orders', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ description: 'Lumivo HY300 projector x' + n, amount: { currency_code: 'USD', value: (PRICE * n).toFixed(2) } }],
        payment_source: { paypal: { experience_context: { shipping_preference: 'GET_FROM_FILE', user_action: 'PAY_NOW', locale: 'en-US' } } }
      })
    });
    const d = await r.json();
    return json({ id: d.id }, r.ok ? 200 : 502);
  } catch (e) { console.error(e); return json({ error: 'server error' }, 500); }
}

export async function captureOrder(req, env) {
  try {
    const { orderID } = await req.json();
    const t = await ppToken(env);
    const r = await fetch(base(env) + '/v2/checkout/orders/' + encodeURIComponent(orderID) + '/capture', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
    const d = await r.json();
    const pu = d.purchase_units?.[0], cap = pu?.payments?.captures?.[0];
    const live = env.PAYPAL_ENV === 'live';
    // Only continue when PayPal itself says the money was captured.
    if (d.status !== 'COMPLETED' || !cap) {
      const reason = d.details?.[0]?.issue || d.name || d.status || ('HTTP ' + r.status);
      console.error('PayPal capture failed', orderID, JSON.stringify({ status: r.status, name: d.name, details: d.details, debug_id: d.debug_id }));
      return json({ ok: false, reason: live ? undefined : reason }, 402);
    }
    if (cap.status !== 'COMPLETED') {
      const why = cap.status_details?.reason || cap.status;
      console.error('PayPal capture pending', orderID, why);
      await notify(env, 'PAYMENT ON HOLD: LUM-' + orderID, 'PayPal took the payment but marked it ' + cap.status + ' (' + why + ').\nCheck it in your PayPal account. Do not ship until it shows Completed.');
      return json({ ok: true, ref: 'LUM-' + orderID, pending: true, reason: live ? undefined : why });
    }
    const qty = Math.min(9, Math.max(1, Math.round(Number(cap.amount.value) / PRICE)));
    const s = pu.shipping || {}, a = s.address || {}, ref = 'LUM-' + orderID;
    const cc = a.country_code || '';
    const info = `Order ${ref}\nQty: ${qty}  Paid: ${cap.amount.value} ${cap.amount.currency_code}\nName: ${s.name?.full_name}\nAddress: ${a.address_line_1} ${a.address_line_2 || ''}, ${a.admin_area_2}, ${a.admin_area_1} ${a.postal_code}, ${cc}\nEmail: ${d.payer?.email_address}`;
    if (!live && env.CJ_TEST !== 'yes') {
      const mail = await notify(env, 'Test order ' + ref + ' (not sent to CJ)', info + '\n\nSandbox payment, so it was not sent to CJ. Set CJ_TEST=yes to test the CJ step.');
      return json({ ok: true, ref, cj: 'Not sent to CJ (test mode). ' + mail });
    }
    let cjNote = '', mailNote = '';
    try {
      if (!env.CJ_API_KEY) throw new Error('CJ_API_KEY is not set');
      const token = await cjToken(env);
      const vid = env.CJ_VID || await usVariant(env, token);
      const o = await (await fetch(CJ + 'shopping/order/createOrderV2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': token },
        body: JSON.stringify({
          orderNumber: (live ? '' : 'TEST-') + ref, shippingCountryCode: cc,
          shippingCountry: countryName(cc),
          shippingProvince: a.admin_area_1, shippingCity: a.admin_area_2,
          shippingAddress: a.address_line_1, shippingAddress2: a.address_line_2 || '',
          shippingCustomerName: s.name?.full_name, shippingZip: a.postal_code,
          shippingPhone: d.payer?.phone?.phone_number?.national_number || env.DEFAULT_PHONE || '0000000000',
          email: d.payer?.email_address,
          logisticName: env.CJ_LOGISTIC || 'CJPacket SP Sensitive',
          fromCountryCode: 'CN',
          products: [{ vid, quantity: qty }]
        })
      })).json();
      if (!o.result) throw new Error('CJ order rejected: ' + o.message);
      cjNote = 'Sent to CJ: ' + (o.data?.orderId || 'ok');
      mailNote = await notify(env, (live ? 'New paid order ' : 'TEST order ') + ref + ': created at CJ', info + '\n\nCJ variant: ' + vid + '\nCJ order: ' + JSON.stringify(o.data) + (live ? '\nOpen CJ > Orders and pay it if it is awaiting payment.' : '\nThis was a test. Delete it in CJ > Orders and do not pay it.'));
    } catch (e) {
      cjNote = 'Not sent to CJ: ' + e.message;
      mailNote = await notify(env, 'ACTION NEEDED: order ' + ref + ' not sent to CJ', info + '\n\nReason: ' + e.message + (live ? '\nPlace this order in CJ by hand.' : ''));
    }
    return json({ ok: true, ref, cj: live ? undefined : cjNote + ' | ' + mailNote });
  } catch (e) { console.error(e); return json({ ok: false }, 500); }
}
