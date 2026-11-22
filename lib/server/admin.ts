// For the server's own work, like recording a Stripe payment: queries that run past the
// row level security policies. Never reachable from a browser.

import { queryClient } from '../query-builder';
import { execute } from './query';

export const adminDb = queryClient((request) => execute(request, { role: 'service_role' }));
