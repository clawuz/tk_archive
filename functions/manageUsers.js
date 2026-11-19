const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

const ALLOWED_DOMAINS = ['tribalistanbul.com', 'twist.ddb.com', 'thy.com'];
const VALID_ROLES = ['viewer', 'admin', 'super_admin'];

function isAllowedDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return false;
  const domain = email.split('@')[1].toLowerCase();
  return ALLOWED_DOMAINS.includes(domain);
}

// Corporate mail security scanners (Microsoft 365 Safe Links etc.) prefetch
// links in incoming mail, which consumes Firebase's one-time password-reset
// code before the actual recipient clicks it — confirmed happening on
// twist.ddb.com. So new accounts get a random password set directly instead
// of relying on the email link; the admin relays it out-of-band.
function generateTempPassword() {
  return 'TK-' + crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12) + '!' + new Date().getFullYear();
}

// Both callables below are admin-only actions, but Firebase Auth custom
// claims aren't in use here — role lives in Firestore (`users/{uid}.role`,
// same field the client reads) — so the caller's own doc is fetched and
// checked on every call rather than trusting anything the client asserts.
async function requireStaffCaller(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Giriş yapmalısınız.');
  }
  const db = admin.firestore();
  const callerSnap = await db.collection('users').doc(context.auth.uid).get();
  const callerRole = callerSnap.exists ? callerSnap.data().role : null;
  if (callerRole !== 'admin' && callerRole !== 'super_admin') {
    throw new functions.https.HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
  }
  return callerRole;
}

/**
 * Admin-triggered account creation — unlike requestAccess (self-serve,
 * always role: 'viewer'), this lets an admin pick the role up front so they
 * don't have to create-then-promote in two steps. Creation only: the client
 * follows up with the standard `sendPasswordResetEmail` to actually invite
 * the new user, same as requestAccess.
 */
async function createUserHandler(data, context) {
  await requireStaffCaller(context);

  const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
  const role = VALID_ROLES.includes(data?.role) ? data.role : 'viewer';

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
  let tempPassword = null;
  try {
    userRecord = await auth.getUserByEmail(email);
    // Already exists — just make sure the Firestore doc matches the
    // requested role rather than silently no-op-ing like requestAccess does.
    // Password is left untouched here; only a fresh account gets one set.
    await db.collection('users').doc(userRecord.uid).set({ role }, { merge: true });
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    tempPassword = generateTempPassword();
    userRecord = await auth.createUser({ email, emailVerified: false, password: tempPassword });
    await db.collection('users').doc(userRecord.uid).set({
      email,
      role,
      department: null,
      createdAt: Date.now(),
    });
  }

  return { ok: true, uid: userRecord.uid, tempPassword };
}

/**
 * Removes a user entirely — Auth account and Firestore profile both. Guards
 * against the two ways this could lock everyone out: deleting your own
 * account, and deleting the last remaining super_admin.
 */
async function deleteUserHandler(data, context) {
  await requireStaffCaller(context);

  const uid = typeof data?.uid === 'string' ? data.uid : '';
  if (!uid) {
    throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir kullanıcı belirtilmedi.');
  }
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError('failed-precondition', 'Kendi hesabınızı silemezsiniz.');
  }

  const db = admin.firestore();
  const targetSnap = await db.collection('users').doc(uid).get();
  if (targetSnap.exists && targetSnap.data().role === 'super_admin') {
    const superAdmins = await db.collection('users').where('role', '==', 'super_admin').get();
    if (superAdmins.size <= 1) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Son super_admin silinemez — önce başka birini super_admin yapın.'
      );
    }
  }

  await db.collection('users').doc(uid).delete();
  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }

  return { ok: true };
}

const adminCreateUser = functions.https.onCall(createUserHandler);
const adminDeleteUser = functions.https.onCall(deleteUserHandler);

module.exports = {
  adminCreateUser,
  adminDeleteUser,
  createAdminCreateUserHandler: createUserHandler,
  createAdminDeleteUserHandler: deleteUserHandler,
};
