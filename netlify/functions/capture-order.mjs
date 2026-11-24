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
// CJ has several lookups; try them in turn because some products only answer to one.
async function usVariant(token) {
  const get = async (path) => (await fetch(CJ + path, { headers: { 'CJ-Access-Token': token } })).json();
  const asList = (d) => Array.isArray(d) ? d : (d?.variants || d?.list || []);
  const tried = [];
  let vs = [];
  const q = encodeURIComponent(PRODUCT_SKU);
  for (const path of ['product/variant/query?productSku=' + q, 'product/query?productSku=' + q]) {
    const r = await get(path); vs = asList(r.data); tried.push(path.split('?')[0] + ': ' + (vs.length ? vs.length + ' variants' : r.message));
    if (vs.length) break;
  }
  if (!vs.length) {
    const r = await get('product/listV2?keyWord=' + q + '&page=1&size=20');
    const items = (r.data?.content || []).flatMap((c) => c.productList || []);
    const hit = items.find((i) => i.sku === PRODUCT_SKU || i.spu === PRODUCT_SKU) || (items.length === 1 ? items[0] : null);
    tried.push('listV2: ' + (hit ? 'found ' + hit.id : items.length + ' results, ' + r.message));
    if (hit) { const v = await get('product/variant/query?pid=' + encodeURIComponent(hit.id)); vs = asList(v.data); tried.push('variants by pid: ' + (vs.length || v.message)); }
  }
  const label = (v) => [v.variantKey, v.variantNameEn, v.variantSku].filter(Boolean).join(' / ');
  const us = vs.filter((v) => /(^|[^a-z])us([^a-z]|$)/i.test(label(v)));
  if (us.length !== 1) throw new Error(vs.length
    ? 'Could not pick the US-plug variant. Set CJ_VID in Netlify to one of: ' + vs.map((v) => v.vid + ' = ' + label(v)).join('; ')
    : 'CJ could not find product ' + PRODUCT_SKU + ' (' + tried.join(' | ') + ')');
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
    const live = process.env.PAYPAL_ENV === 'live';
    // Only continue when PayPal itself says the money was captured.
    if (d.status !== 'COMPLETED' || !cap) {
      const reason = d.details?.[0]?.issue || d.name || d.status || ('HTTP ' + r.status);
      console.error('PayPal capture failed', orderID, JSON.stringify({ status: r.status, name: d.name, details: d.details, debug_id: d.debug_id }));
      return json({ ok: false, reason: live ? undefined : reason }, 402);
    }
    if (cap.status !== 'COMPLETED') {
      // Money is taken but PayPal is holding it (e.g. review). Do not ship until PayPal releases it.
      const why = cap.status_details?.reason || cap.status;
      console.error('PayPal capture pending', orderID, why);
      await notify('PAYMENT ON HOLD: LUM-' + orderID, 'PayPal took the payment but marked it ' + cap.status + ' (' + why + ').\nCheck it in your PayPal account. Do not ship until it shows Completed.');
      return json({ ok: true, ref: 'LUM-' + orderID, pending: true, reason: live ? undefined : why });
    }
    const qty = Math.min(9, Math.max(1, Math.round(Number(cap.amount.value) / PRICE)));
    const s = pu.shipping || {}, a = s.address || {}, ref = 'LUM-' + orderID;
    const cc = a.country_code || '';
    const info = `Order ${ref}\nQty: ${qty}  Paid: ${cap.amount.value} ${cap.amount.currency_code}\nName: ${s.name?.full_name}\nAddress: ${a.address_line_1} ${a.address_line_2 || ''}, ${a.admin_area_2}, ${a.admin_area_1} ${a.postal_code}, ${cc}\nEmail: ${d.payer?.email_address}`;
    if (!live && process.env.CJ_TEST !== 'yes') {
      const mail = await notify('Test order ' + ref + ' (not sent to CJ)', info + '\n\nSandbox payment, so it was not sent to CJ. Set CJ_TEST=yes in Netlify to test the CJ step.');
      return json({ ok: true, ref, cj: 'Not sent to CJ (test mode). ' + mail });
    }
    let cjNote = '', mailNote = '';
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
      cjNote = 'Sent to CJ: ' + (o.data?.orderId || 'ok');
      mailNote = await notify((live ? 'New paid order ' : 'TEST order ') + ref + ': created at CJ', info + '\n\nCJ variant: ' + vid + '\nCJ order: ' + JSON.stringify(o.data) + (live ? '\nOpen CJ > Orders and pay it if it is awaiting payment.' : '\nThis was a test. Delete it in CJ > Orders and do not pay it.'));
    } catch (e) {
      cjNote = 'Not sent to CJ: ' + e.message;
      mailNote = await notify('ACTION NEEDED: order ' + ref + ' not sent to CJ', info + '\n\nReason: ' + e.message + (live ? '\nPlace this order in CJ by hand.' : ''));
    }
    return json({ ok: true, ref, cj: live ? undefined : cjNote + ' | ' + mailNote });
  } catch (e) { console.error(e); return json({ ok: false }, 500); }
};
