import { PRICE, base, ppToken, json, notify } from '../lib/shared.mjs';
export const config = { path: '/api/capture-order' };
const CJ = 'https://developers.cjdropshipping.com/api2.0/v1/';
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
    try {
      if (!process.env.CJ_API_KEY || !process.env.CJ_VID) throw new Error('CJ_API_KEY or CJ_VID not set');
      const tk = await (await fetch(CJ + 'authentication/getAccessToken', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: process.env.CJ_API_KEY }) })).json();
      const token = tk.data?.accessToken;
      if (!token) throw new Error('CJ auth failed: ' + tk.message);
      const o = await (await fetch(CJ + 'shopping/order/createOrderV2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': token },
        body: JSON.stringify({
          orderNumber: ref, shippingCountryCode: cc,
          shippingCountry: new Intl.DisplayNames(['en'], { type: 'region' }).of(cc),
          shippingProvince: a.admin_area_1, shippingCity: a.admin_area_2,
          shippingAddress: a.address_line_1, shippingAddress2: a.address_line_2 || '',
          shippingCustomerName: s.name?.full_name, shippingZip: a.postal_code,
          shippingPhone: d.payer?.phone?.phone_number?.national_number || process.env.DEFAULT_PHONE || '0000000000',
          email: d.payer?.email_address,
          logisticName: process.env.CJ_LOGISTIC || 'CJPacket SP Sensitive',
          fromCountryCode: 'CN',
          products: [{ vid: process.env.CJ_VID, quantity: qty }]
        })
      })).json();
      if (!o.result) throw new Error('CJ order rejected: ' + o.message);
      await notify('New paid order ' + ref + ': created at CJ', info + '\n\nCJ order: ' + JSON.stringify(o.data) + '\nOpen CJ > Orders and pay it if it is awaiting payment.');
    } catch (e) {
      await notify('ACTION NEEDED: paid order ' + ref + ' not sent to CJ', info + '\n\nReason: ' + e.message + '\nPlace this order in CJ by hand.');
    }
    return json({ ok: true, ref });
  } catch (e) { console.error(e); return json({ ok: false }, 500); }
};
