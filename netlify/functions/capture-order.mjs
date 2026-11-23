import { PRICE, base, ppToken, json, notify } from '../lib/shared.mjs';
export const config = { path: '/api/capture-order' };
const CJ = 'https://developers.cjdropshipping.com/api2.0/v1/';
const PRODUCT_SKU = process.env.CJ_PRODUCT_SKU || 'CJYD273577104DW';
let cached = null; // CJ limits how often a token can be requested, so reuse it while this instance is warm
async function cjToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const tk = await (await fetch(CJ + 'authentication/getAccessToken', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: process.env.CJ_API_KEY }) })).json();
  if (!tk.data?.accessToken) throw new Error('CJ login failed: ' + tk.message);
  cached = { token: tk.data.accessToken, until: Date.now() + 12 * 3600e3 };
  return cached.token;
}
// Finds the US-plug variant of the product, so the order matches what the store sells.
async function usVariant(token) {
  const r = await (await fetch(CJ + 'product/query?productSku=' + encodeURIComponent(PRODUCT_SKU), { headers: { 'CJ-Access-Token': token } })).json();
  const vs = r.data?.variants || [];
  const label = (v) => [v.variantKey, v.variantNameEn, v.variantSku].filter(Boolean).join(' / ');
  const us = vs.filter((v) => /(^|[^a-z])us([^a-z]|$)/i.test(label(v)));
  if (us.length !== 1) throw new Error('Could not pick the US-plug variant automatically. Set CJ_VID in Netlify to one of: ' + vs.map((v) => v.vid + ' = ' + label(v)).join('; ') + (vs.length ? '' : ' (no variants found: ' + r.message + ')'));
  return us[0].vid;
}
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { orderID } = await req.json();
    const t = await ppToken();
    const r = await fetch(base() + '/v2/checkout/orders/' + encodeURIComponent(orderID) + '/capture', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
    const d = await r.json();
    const pu = d.purchase_units?.[0], cap = pu?.payments?.captures?.[0];
    // Only continue when PayPal itself says the money was captured.
    if (d.status !== 'COMPLETED' || cap?.status !== 'COMPLETED') return json({ ok: false }, 402);
    const qty = Math.min(9, Math.max(1, Math.round(Number(cap.amount.value) / PRICE)));
    const s = pu.shipping || {}, a = s.address || {}, ref = 'LUM-' + orderID;
    const cc = a.country_code || '';
    const info = `Order ${ref}\nQty: ${qty}  Paid: ${cap.amount.value} ${cap.amount.currency_code}\nName: ${s.name?.full_name}\nAddress: ${a.address_line_1} ${a.address_line_2 || ''}, ${a.admin_area_2}, ${a.admin_area_1} ${a.postal_code}, ${cc}\nEmail: ${d.payer?.email_address}`;
    const live = process.env.PAYPAL_ENV === 'live';
    if (!live && process.env.CJ_TEST !== 'yes') {
      await notify('Test order ' + ref + ' (not sent to CJ)', info + '\n\nSandbox payment, so it was not sent to CJ. Set CJ_TEST=yes in Netlify to test the CJ step.');
      return json({ ok: true, ref });
    }
    try {
      if (!process.env.CJ_API_KEY) throw new Error('CJ_API_KEY is not set in Netlify');
      const token = await cjToken();
      const vid = process.env.CJ_VID || await usVariant(token);
      const o = await (await fetch(CJ + 'shopping/order/createOrderV2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': token },
        body: JSON.stringify({
          orderNumber: (live ? '' : 'TEST-') + ref, shippingCountryCode: cc,
          shippingCountry: new Intl.DisplayNames(['en'], { type: 'region' }).of(cc),
          shippingProvince: a.admin_area_1, shippingCity: a.admin_area_2,
          shippingAddress: a.address_line_1, shippingAddress2: a.address_line_2 || '',
          shippingCustomerName: s.name?.full_name, shippingZip: a.postal_code,
          shippingPhone: d.payer?.phone?.phone_number?.national_number || process.env.DEFAULT_PHONE || '0000000000',
          email: d.payer?.email_address,
          logisticName: process.env.CJ_LOGISTIC || 'CJPacket SP Sensitive',
          fromCountryCode: 'CN',
          products: [{ vid, quantity: qty }]
        })
      })).json();
      if (!o.result) throw new Error('CJ order rejected: ' + o.message);
      await notify((live ? 'New paid order ' : 'TEST order ') + ref + ': created at CJ', info + '\n\nCJ variant: ' + vid + '\nCJ order: ' + JSON.stringify(o.data) + (live ? '\nOpen CJ > Orders and pay it if it is awaiting payment.' : '\nThis was a test. Delete it in CJ > Orders and do not pay it.'));
    } catch (e) {
      await notify('ACTION NEEDED: order ' + ref + ' not sent to CJ', info + '\n\nReason: ' + e.message + (live ? '\nPlace this order in CJ by hand.' : ''));
    }
    return json({ ok: true, ref });
  } catch (e) { console.error(e); return json({ ok: false }, 500); }
};
