LUMIVO STORE: setup (Netlify + PayPal + CJ)

1) Nothing to edit. The page reads your Client ID from the Netlify variable below.
2) Put this whole folder on GitHub (new repo > "uploading an existing file"), then in Netlify:
   Add new project > Import from Git. No build command needed.
3) Netlify > Project configuration > Environment variables. Add:
   PAYPAL_CLIENT_ID   your sandbox Client ID
   PAYPAL_SECRET      your sandbox Secret   (never put it in a file or in chat)
   PAYPAL_ENV         sandbox   (change to live when going live)
   CJ_API_KEY         from CJ > API > Add API (type API Key)
   CJ_VID             the CJ variant id of the HY300 950S AU/US variant (CJ product page / API)
   CJ_LOGISTIC        optional, default "CJPacket SP Sensitive" (must match a CJ logistics name)
   RESEND_API_KEY     optional, from resend.com, for email alerts
   OWNER_EMAIL        optional, where alerts go
   Redeploy once after adding variables.
4) Test: use a PayPal sandbox buyer account. Check your alert email and CJ > Orders.
5) Going live: switch PayPal to Live, create a live app, put the live Client ID and
   Secret into the Netlify variables, set PAYPAL_ENV=live, redeploy. No file edits needed.

Notes
- Each production deploy uses 15 Netlify credits. Test with preview deploys.
- The CJ order call follows CJ's API docs, but test it: CJ may need the order paid
  inside CJ after creation, and logistics names must match exactly.
- Add shipping, returns, privacy and terms pages before going live.
