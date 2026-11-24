import { createOrder } from '../../lib/store.mjs';
export const onRequestPost = ({ request, env }) => createOrder(request, env);
