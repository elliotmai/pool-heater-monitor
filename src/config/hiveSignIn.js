/*
 * Owners sign in with Hive to change settings or send the Pi a command.
 *
 * Anyone can look at the dashboard. Writing to the database needs a Firebase
 * sign-in that carries `pool_owner` (database.rules.json); the hiveSignIn
 * function hands one to the pool's owners, recognised by their Hive session —
 * the cookie every app on flyingdoublemranch.com shares. Signed in to Hive?
 * Then you're signed in here; nothing to type.
 */
import { createBrowserClient } from '@supabase/ssr';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { app } from './firebase';

const SUPABASE_URL = 'https://fcjiummxpacwriwopcho.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fZo1FUg_j4O1EHH-W2Jr1A_4P8W3o2S';
const EXCHANGE_URL = 'https://us-central1-water-heater-sensors.cloudfunctions.net/hiveSignIn';
export const HIVE_SIGN_IN_URL = 'https://hive.flyingdoublemranch.com';

const SHARED_DOMAIN = 'flyingdoublemranch.com';
const host = window.location.hostname;
const shared = host === SHARED_DOMAIN || host.endsWith(`.${SHARED_DOMAIN}`);

const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  cookieOptions: {
    name: 'hive-auth', path: '/', sameSite: 'lax', secure: window.location.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 400, ...(shared ? { domain: `.${SHARED_DOMAIN}` } : {}),
  },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

let attempt = null;

/** 'owner' | 'not-owner' | 'signed-out' | 'unavailable' — tries once per page load. */
export function ownerSignIn() {
  attempt ??= (async () => {
    const auth = getAuth(app);
    await auth.authStateReady();
    if (auth.currentUser) return 'owner';
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return 'signed-out';
    try {
      const r = await fetch(EXCHANGE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken }) });
      const body = await r.json().catch(() => ({}));
      if (r.status === 403) return 'not-owner';
      if (!r.ok || !body.token) return 'unavailable';
      await signInWithCustomToken(auth, body.token);
      return 'owner';
    } catch {
      return 'unavailable';
    }
  })();
  return attempt;
}
