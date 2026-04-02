# TK Archive

Google Drive için basit bir arşiv sistemi. Bu proje, Google Drive içeriğini tarayıp meta verisini indeksler, etiketler eklemeyi ve etiket bazlı arama yapmayı sağlar.

## Özellikler

- Google OAuth 2.0 ile Google hesabına bağlanma
- Drive içindeki dosyaları tarayıp indeksleme
- otomatik etiket önerisi
- arama alanında `business class`, `video`, `sunum`, `psd`, `air to air` gibi anahtar kelimeyle filtreleme
- her sonucun yanında link ve ön izleme

## Kurulum

1. Proje dizinine geçin
   ```bash
   cd /Users/okilavuz/Desktop/omer_works/TK_Archive
   ```
2. Bağımlılıkları yükleyin
   ```bash
   npm install
   ```
3. `.env.example` dosyasını `.env` olarak kopyalayın ve Google Cloud Console üzerinden aldığınız `CLIENT_ID` / `CLIENT_SECRET` değerlerini ekleyin.

4. Google Cloud Console'da OAuth istemcisi oluşturun ve yönlendirme URI'sine aşağıdakini ekleyin:
   ```text
   http://localhost:4000/auth/google/callback
   ```

5. Sunucuyu çalıştırın
   ```bash
   npm start
   ```

6. Tarayıcıda `http://localhost:4000` adresini açın.

## Kullanım

- `Google Hesabını Bağla` butonuna tıklayın
- sonra `Drive'ı Tara` ile Google Drive verilerinizi indeksleyin
- arama çubuğuna `business class`, `video`, `sunum`, `psd`, `air to air` gibi kelimeler yazarak arama yapabilirsiniz

## Dosya Yapısı

- `server.js` - yerel Express backend ve Google Drive entegrasyonu
- `public/` - ön yüz HTML, CSS, JavaScript
- `data/db.json` - yerelde taranan dosya metadata depolaması
- `functions/` - Firebase Functions API sunucusu
- `firebase.json` - Firebase Hosting ve Functions yapılandırması
- `.firebaserc` - Firebase projesi ayarı

## Firebase Dağıtımı

1. Firebase CLI ile proje ayarının yüklü olduğundan emin olun:
   ```bash
   firebase login
   firebase use tk-archive-cd9d0
   ```

2. Firebase Functions için Google OAuth bilgilerini ayarlayın (projenizde gizli bilgileri saklamak için):
   ```bash
   firebase functions:config:set google.client_id="YOUR_CLIENT_ID" google.client_secret="YOUR_CLIENT_SECRET" base_url="https://tk-archive-cd9d0.web.app" session_key="YOUR_SESSION_KEY"
   ```

3. Firestore'u projede aktifleştirin. Firebase konsolunda `Firestore Database` bölümüne gidin ve veritabanını oluşturun.

4. Deploy edin:
   ```bash
   npm run deploy
   ```

5. Eğer yerelde Firebase emülatörlerini çalıştırmak isterseniz:
   ```bash
   npm run serve
   ```

## Notlar

- Bu uygulama MVP seviyesinde bir başlangıçtır.
- İlerleyen aşamada tam metin arama, Google Docs içerik analizleri, kullanıcı yönetimi ve klasör bazlı filtrelemeler eklenebilir.
