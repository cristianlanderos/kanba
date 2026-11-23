// The client every screen imports. It kept its name, `supabase`, and the methods the
// screens call, so they did not change, but nothing here talks to Supabase: queries go
// to this app's /api/db, sign-in to /api/auth, and both end in the app's own Postgres.

import { DbRequest, QueryResult, failed, queryClient } from './query-builder';

async function post(path: string, body: unknown): Promise<{ ok: boolean; body: any }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  return { ok: response.ok, body: await response.json().catch(() => ({})) };
}

async function runQuery(request: DbRequest): Promise<QueryResult> {
  try {
    const { ok, body } = await post('/api/db', request);
    if (body && 'data' in body && 'error' in body) return body;
    return failed(ok ? 'The server sent an answer the board cannot read' : 'The server could not run that query');
  } catch (error: any) {
    return failed(error?.message || 'The server is not reachable');
  }
}

type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT';
type AuthListener = (event: AuthEvent, session: any) => void;

const listeners = new Set<AuthListener>();
const tell = (event: AuthEvent, session: any) => listeners.forEach((listener) => listener(event, session));

async function readSession(): Promise<any> {
  if (typeof window === 'undefined') return null;
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    return (await response.json()).session || null;
  } catch {
    return null;
  }
}

async function signIn(path: string, body: unknown) {
  try {
    const { ok, body: answer } = await post(path, body);
    if (!ok) return { data: { user: null, session: null }, error: { message: answer.error || 'Sign-in failed' } };
    tell('SIGNED_IN', answer.session);
    return { data: { user: answer.user, session: answer.session }, error: null };
  } catch (error: any) {
    return { data: { user: null, session: null }, error: { message: error?.message || 'The server is not reachable' } };
  }
}

const auth = {
  async getSession() {
    return { data: { session: await readSession() }, error: null };
  },

  async getUser() {
    const session = await readSession();
    return { data: { user: session ? session.user : null }, error: null };
  },

  signUp(credentials: { email: string; password: string; options?: { data?: Record<string, any> } }) {
    return signIn('/api/auth/signup', credentials);
  },

  signInWithPassword(credentials: { email: string; password: string }) {
    return signIn('/api/auth/login', credentials);
  },

  /** Signing in through Google or GitHub needed Supabase. This server knows email and password only. */
  async signInWithOAuth(_options: { provider: string; options?: Record<string, any> }) {
    return { data: { provider: null, url: null }, error: { message: 'This server signs in with email and password only' } };
  },

  async signOut() {
    try {
      await post('/api/auth/logout', {});
    } catch {}
    tell('SIGNED_OUT', null);
    return { error: null };
  },

  /** Calls back once with the session the page loaded with, then on every sign-in and sign-out here. */
  onAuthStateChange(listener: AuthListener) {
    listeners.add(listener);
    readSession().then((session) => {
      if (listeners.has(listener)) listener('INITIAL_SESSION', session);
    });
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  },
};

/** How often a screen that subscribed to changes looks again. */
const WATCH_EVERY = 15_000;

/**
 * Supabase pushed changes over a websocket. Here a subscription asks its screen to look
 * again every few seconds, while the tab is in view: enough for the notification bell.
 */
function channel(_name: string) {
  const callbacks: Array<(payload: any) => void> = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  const subscription = {
    on(_type: string, _filter: unknown, callback: (payload: any) => void) {
      callbacks.push(callback);
      return subscription;
    },
    subscribe() {
      if (typeof window !== 'undefined' && !timer) {
        timer = setInterval(() => {
          if (!document.hidden) callbacks.forEach((callback) => callback({}));
        }, WATCH_EVERY);
      }
      return subscription;
    },
    unsubscribe() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
  return subscription;
}

export const supabase = {
  ...queryClient(runQuery),
  auth,
  channel,
  removeChannel(subscription: { unsubscribe: () => void }) {
    subscription.unsubscribe();
  },
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          subscription_status: 'free' | 'pro' | null;
          stripe_customer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          subscription_status?: 'free' | 'pro' | null;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          subscription_status?: 'free' | 'pro' | null;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      projects: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          user_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          user_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          user_id?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      columns: {
        Row: {
          id: string;
          name: string;
          project_id: string;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          project_id: string;
          position: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          project_id?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          column_id: string;
          position: number;
          priority: 'low' | 'medium' | 'high';
          due_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          column_id: string;
          position: number;
          priority?: 'low' | 'medium' | 'high';
          due_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          column_id?: string;
          position?: number;
          priority?: 'low' | 'medium' | 'high';
          due_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
};