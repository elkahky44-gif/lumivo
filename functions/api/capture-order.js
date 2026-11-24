import { captureOrder } from '../../lib/store.mjs';
export const onRequestPost = ({ request, env }) => captureOrder(request, env);
