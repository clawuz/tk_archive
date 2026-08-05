#!/usr/bin/env node
import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'tk-archive-cd9d0'
});

const auth = admin.auth();

async function getUserUID() {
  try {
    const user = await auth.getUserByEmail('omer.kilavuz@twist.ddb.com');
    console.log(`✅ User UID: ${user.uid}`);
    console.log(`   Email: ${user.email}`);
    return user.uid;
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

getUserUID().then(() => process.exit(0));
