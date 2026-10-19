// A concrete nested route is required for Pages Functions to serve the
// screenshot reader at /auth/chat/extract (the optional auth catch-all only
// reliably covers one segment on every deployment configuration).
export { onRequest } from '../../darts/[[path]].js';
