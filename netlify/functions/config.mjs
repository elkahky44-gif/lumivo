export const config = { path: '/api/config' };
export default async () => new Response(JSON.stringify({ id: process.env.PAYPAL_CLIENT_ID || '' }), { headers: { 'Content-Type': 'application/json' } });
