#!/usr/bin/env node
import admin from 'firebase-admin';

// Use application default credentials from gcloud
admin.initializeApp({
  projectId: 'tk-archive-cd9d0'
});

const auth = admin.auth();

async function createUser(email, password) {
  try {
    const user = await auth.createUser({
      email,
      password,
      emailVerified: false,
    });
    console.log('✅ User oluşturuldu:');
    console.log(`   Email: ${user.email}`);
    console.log(`   UID: ${user.uid}`);
  } catch (error) {
    console.error('❌ Hata:', error.message);
    process.exit(1);
  }
}

const email = 'omer.kilavuz@twist.ddb.com';
const password = '19331933';

console.log(`Creating user: ${email}...`);
createUser(email, password);
