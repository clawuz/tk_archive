#!/usr/bin/env node
import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'tk-archive-cd9d0'
});

const { HttpsCallableOptions } = await import('firebase-admin/functions');
const functions = admin.functions('us-central1');

async function testGetScanStatus() {
  const jobId = 'job-completed-1785852537652'; // From seed data

  try {
    // Get a test auth token - use service account
    const token = await admin.auth().createCustomToken('4vwo5gFYUPPnazkE38ihrIXutsh2');

    console.log(`Testing getScanStatus with jobId: ${jobId}`);

    // Call the function via REST API instead of SDK
    const response = await fetch(
      'https://us-central1-tk-archive-cd9d0.cloudfunctions.net/getScanStatus',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: { jobId },
        }),
      }
    );

    const result = await response.json();
    console.log('Response status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }

  process.exit(0);
}

testGetScanStatus();
