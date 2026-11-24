/*
 * The pool's data lives in Hive's Supabase project (schema `pool`), so this
 * app shares one sign-in with Hive and every app under flyingdoublemranch.com:
 * the session is the `hive-auth` cookie for the whole domain. Signed in to
 * Hive? Then you're signed in here; nothing to type.
 *
 * Anyone can look at the dashboard (while the household keeps viewing open).
 * Changing settings or sending the Pi a command takes being in the household
 * that owns the pool — row-level security checks that, not this file. Both
 * values below are public by design.
 */
import { createBrowserClient } from '@supabase/ssr';

export const SUPABASE_URL = 'https://fcjiummxpacwriwopcho.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fZo1FUg_j4O1EHH-W2Jr1A_4P8W3o2S';
export const HIVE_SIGN_IN_URL = 'https://hive.flyingdoublemranch.com';

const SHARED_DOMAIN = 'flyingdoublemranch.com';
const host = window.location.hostname;
const shared = host === SHARED_DOMAIN || host.endsWith(`.${SHARED_DOMAIN}`);

export const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  cookieOptions: {
    name: 'hive-auth', path: '/', sameSite: 'lax', secure: window.location.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 400, ...(shared ? { domain: `.${SHARED_DOMAIN}` } : {}),
  },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export const pool = supabase.schema('pool');

let site = null;

/** The household whose pool this is (there is one). */
export function poolHousehold() {
  site ??= pool.from('sites').select('household_id').limit(1).maybeSingle()
    .then(({ data, error }) => {
      if (error || !data) { site = null; throw error || new Error('No pool to show'); }
      return data.household_id;
    });
  return site;
}

let attempt = null;

/** 'owner' | 'not-owner' | 'signed-out' | 'unavailable' — asks once per page load. */
export function ownerSignIn() {
  attempt ??= (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return 'signed-out';
      const hid = await poolHousehold();
      const { data: member, error } = await supabase.schema('core').rpc('is_member', { hid });
      if (error) return 'unavailable';
      return member ? 'owner' : 'not-owner';
    } catch {
      return 'unavailable';
    }
  })();
  return attempt;
}
