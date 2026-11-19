const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Kept in sync by hand with src/auth/domainCheck.js — functions/ is a
// separate deploy target from the Vite app, so it can't import that file
// directly. Never trust the client's own domain check for this: anyone can
// call a callable function directly, bypassing whatever the login page did.
const ALLOWED_DOMAINS = ['tribalistanbul.com', 'twist.ddb.com', 'thy.com'];

function isAllowedDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return false;
  const domain = email.split('@')[1].toLowerCase();
  return ALLOWED_DOMAINS.includes(domain);
}

/**
 * Self-serve account provisioning. A visitor on the login page who has no
 * password yet enters their email; this makes sure a Firebase Auth account
 * and a matching `users/{uid}` Firestore doc (role: 'viewer' by default)
 * exist for it, then the client follows up with the standard client-side
 * `sendPasswordResetEmail` to actually deliver a "set your password" link —
 * Firebase Auth's own hosted email flow, no custom mail sending needed here.
 *
 * Public (no context.auth — the caller isn't logged in yet by definition).
 * The domain allowlist is what keeps this from being an open account-creation
 * endpoint; every check below runs server-side regardless of what the client
 * already validated.
 */
async function handler(data) {
  const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir e-posta adresi girin.');
  }
  if (!isAllowedDomain(email)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Yalnızca @tribalistanbul.com, @twist.ddb.com ve @thy.com adresleriyle hesap oluşturulabilir.'
    );
  }

  const auth = admin.auth();
  const db = admin.firestore();

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    userRecord = await auth.createUser({ email, emailVerified: false });
    await db.collection('users').doc(userRecord.uid).set({
      email,
      role: 'viewer',
      department: null,
      createdAt: Date.now(),
    });
  }

  return { ok: true };
}

const requestAccess = functions.https.onCall(handler);

module.exports = { requestAccess, createRequestAccessHandler: handler, isAllowedDomain };
