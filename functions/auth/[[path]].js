// Canonical Boplo identity routes. The Darts route remains temporarily for
// existing links while the product moves to its chat-to-reply experience.
import { onRequest as identityRequest } from '../darts/[[path]].js';
export async function onRequest(context) {
  const response = await identityRequest(context);
  const location = response.headers.get('Location');
  if (response.status === 302 && location && new URL(location).hash === '#move') {
    const headers = new Headers(response.headers);
    const destination = new URL(location);
    destination.pathname = '/flight-app.html';
    destination.hash = '';
    headers.set('Location', destination.href);
    return new Response(response.body, {status: response.status, headers});
  }
  return response;
}
