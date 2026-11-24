import { config } from '../../lib/store.mjs';
export const onRequestGet = ({ env }) => config(env);
