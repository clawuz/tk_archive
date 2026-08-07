const admin = require('firebase-admin');
const serviceAccount = require('./config/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'tk-archive-dam'
});

admin.auth().createUser({
  email: 'omer.kilavuz@twist.ddb.com',
  password: '19331933',
  displayName: 'Ömer Kılavuz'
})
.then((userRecord) => {
  console.log('✅ User oluşturuldu!');
  console.log('UID:', userRecord.uid);
  console.log('Email:', userRecord.email);
  process.exit(0);
})
.catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
