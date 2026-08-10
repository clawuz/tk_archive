/**
 * Cloud Function: tagNewFiles
 *
 * Server-side, one-time visual tagging using Claude Vision. Runs against the
 * small thumbnail/frame images already stored in Firestore (no re-read of
 * the original file), so a video's 5 frames and an image's single thumbnail
 * are both cheap vision inputs.
 *
 * Modes:
 * - single: tag a specific file by fileId
 * - batch:  tag up to BATCH_LIMIT files where needs_tagging === true
 *
 * Idempotent by design: once a file is tagged, needs_tagging is set to
 * false, so re-running batch mode never re-charges for the same file.
 *
 * Requires Firebase Auth (this is a write path — see firestore.rules).
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

const db = admin.firestore();

// Haiku: this is single-image classification/tagging, not deep reasoning —
// the cost estimate given to the archive owner ($3-20 one-time for
// thousands of images) was based on Haiku pricing, not Opus.
const MODEL = 'claude-haiku-4-5';
const BATCH_LIMIT = 20;

// THY-specific taxonomy. Kept in one place so it can be extended without
// touching the calling code. Categories the model can't reliably judge from
// pixels alone (production workflow status, business-unit ownership without
// a visible logo) are intentionally excluded — see the conversation history
// for why; those are handled by folder-based tagging or manual entry instead.
const TAXONOMY_PROMPT = `Bu bir Turkish Airlines (THY) dijital arşiv görselidir. Görseli incele ve aşağıdaki kategorilerden GÖRSELDE GERÇEKTEN GÖRÜNEN olanları etiketle. Emin olmadığın (logo/yazı net görünmeyen) marka, sponsor veya ödülleri ETİKETLEME — yanlış etiket, etiketsiz bırakmaktan daha kötüdür.

UÇAK MODELLERİ — SADECE görseldeki nesnenin kendisi gerçek bir uçak, uçak maketi veya uçak fotoğrafıysa etiketle (kayıt no, motor şekli, kanat ucu şeklinden ayırt et). Kalem, anahtarlık, bere gibi ürünlerde uçak siluetine benzeyen bir TASARIM ÖĞESİ varsa bu bir uçak modeli DEĞİLDİR — spesifik model etiketi (a350, b787 vb.) EKLEME, sadece genel "ucak-tasarimli" etiketini kullanabilirsin:
a350, a321, a330, b707, b737, b777, b787 (Dreamliner ise "dreamliner" de ekle), c-47, de-havilland, fokker, junkers, curtiss-kingbird, ucak-tasarimli

KABİN & PERSONEL:
kabin-memuru, pilot, yer-hizmetleri, check-in-personeli

KABİN SINIFI:
business-class, economy-class, first-class

MEKAN & HAVALİMANI:
business-lounge, miles-and-smiles-lounge, gate, check-in-alani, kokpit, kabin-ici, pist, terminal, apron, iga-ic-mekan, iga-dis-mekan

İKRAM:
do-and-co-ikram, ucan-asci, lounge-ikram

UÇUŞ AŞAMALARI:
kalkis, inis, seyir, binis, ucak-dis-govde

DESTİNASYON & MİRAS:
istanbul, bogazici, kapadokya, gobeklitepe, global-destinasyon

MARKALAR (SADECE logo/renk net görünüyorsa):
turkish-airlines, turkish-cargo, ajet, turkish-technic, miles-and-smiles, tkpay, youth-club, do-and-co, tgs

TK STORE / MERCHANDISE — SADECE görsel gerçekten bir ürünün stüdyo/e-ticaret tarzı çekimiyse (izole arka plan, ürün paketin önünde/tek başına) kullan:
tk-store, ucak-maketi, oyuncak, giyim

SPONSORLUK & ÖDÜL (SADECE logo/grafik net okunuyorsa):
milli-takim, uefa, euroleague, skytrax, apex, guinness

PRODÜKSİYON İÇERİĞİ — bir reklam filmi, kurumsal film veya yayının kare/kapak görseliyse (sahne, oyuncu, el, ofis, masa gibi anlatı unsurları — ürün çekimi DEĞİL):
kurumsal-film, reklam-filmi, kurumsal-yayin

ÖNEMLİ — TEK KARE UYARISI: Sana verilen görsel bazen bir videonun SADECE TEK BİR karesi (Drive'ın otomatik oluşturduğu küçük resim) olabilir — bu, videonun geneli hakkında güvenilir bilgi vermez. Böyle bir karede el, masa, ofis eşyası, biniş kartı gibi belirsiz/anlatısal bir sahne görüyorsan bunu ürün fotoğrafı SANMA — "tk-store" veya "ucak-maketi" gibi ürün etiketleri EKLEME. Bunun yerine "kurumsal-film" veya "reklam-filmi" kullan. Dosya adı sana ek bağlam olarak verilecek (örn. "EPIC FILM", "Anafilm", "MASTER" gibi kelimeler bunun bir film olduğunu gösterir) — bunu görselle birlikte değerlendir.

Fotoğraf gökyüzünde uçan bir uçağı başka bir uçaktan/dışarıdan çekilmiş şekilde gösteriyorsa "air-to-air" etiketini ekle.

En fazla 12 etiket seç, sadece görselde gerçekten olanları. Ayrıca görselde ne olduğunu özetleyen 1-2 cümlelik Türkçe bir açıklama yaz.`;

const TAGGING_OUTPUT_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Slugified, lowercase tags from the taxonomy that are actually visible in the image',
      },
      description: {
        type: 'string',
        description: '1-2 sentence Turkish description of what the image/frame shows',
      },
    },
    required: ['tags', 'description'],
    additionalProperties: false,
  },
};

function extractBase64FromDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

// Drive files store thumbnail.url as a real https:// link (Drive's own
// thumbnailLink), not a data: URI like local files — fetch and inline it so
// buildImageBlocks can treat both sources the same way.
async function fetchAsBase64Image(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const mediaType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mediaType, data: buffer.toString('base64') };
}

/**
 * Builds the image content blocks for a file: video frames if present,
 * otherwise the stored thumbnail, otherwise null (nothing to tag visually).
 */
async function buildImageBlocks(file) {
  if (file.videoPreviewFrames?.length > 0) {
    return file.videoPreviewFrames.slice(0, 5).map((frame) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame.frameData },
    }));
  }

  if (file.thumbnail?.url) {
    const dataUrlParsed = extractBase64FromDataUrl(file.thumbnail.url);
    const parsed = dataUrlParsed || (
      file.thumbnail.url.startsWith('https://') ? await fetchAsBase64Image(file.thumbnail.url) : null
    );
    if (parsed) {
      return [{
        type: 'image',
        source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data },
      }];
    }
  }

  return null;
}

async function tagOneFile(anthropic, fileDoc) {
  const file = fileDoc.data();
  const imageBlocks = await buildImageBlocks(file);

  if (!imageBlocks) {
    return { tags: [], description: null, skipped: true };
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: TAXONOMY_PROMPT,
    messages: [{
      role: 'user',
      content: [
        ...imageBlocks,
        {
          type: 'text',
          text: `Dosya adı: "${file.name}"\n\nBu görseli/kareleri, dosya adını da bağlam olarak kullanarak yukarıdaki taksonomiye göre etiketle.`,
        },
      ],
    }],
    output_config: { format: TAGGING_OUTPUT_SCHEMA },
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('No text block in Claude response');
  }

  const parsed = JSON.parse(textBlock.text);
  const newTags = Array.isArray(parsed.tags) ? parsed.tags.filter(Boolean) : [];
  const description = typeof parsed.description === 'string' ? parsed.description : null;

  const mergedTags = Array.from(new Set([...(file.tags || []), ...newTags]));

  const updates = {
    tags: mergedTags,
    needs_tagging: false,
    taggedAt: admin.firestore.FieldValue.serverTimestamp(),
    tagSource: 'claude-vision',
  };
  if (description) {
    updates.description = description;
    updates.descriptionSource = 'claude-vision';
  }

  await fileDoc.ref.update(updates);

  return { tags: newTags, description, skipped: false };
}

exports.tagNewFiles = functions
  .runWith({ secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { fileId, mode } = data;

    try {
      if (mode === 'single' && fileId) {
        const fileRef = db.collection('files').doc(fileId);
        const fileDoc = await fileRef.get();
        if (!fileDoc.exists) {
          throw new functions.https.HttpsError('not-found', 'File not found');
        }

        const result = await tagOneFile(anthropic, fileDoc);
        if (result.skipped) {
          await fileRef.update({ needs_tagging: false });
        }
        return {
          success: true,
          fileId,
          tags: result.tags,
          description: result.description,
          message: result.skipped
            ? 'No visual content to tag (no thumbnail or frames)'
            : `Tagged file with ${result.tags.length} tags`,
        };
      }

      if (mode === 'batch') {
        const untagged = await db.collection('files')
          .where('needs_tagging', '==', true)
          .limit(BATCH_LIMIT)
          .get();

        let taggedCount = 0;
        let skippedCount = 0;
        const batchErrors = [];

        for (const fileDoc of untagged.docs) {
          try {
            const result = await tagOneFile(anthropic, fileDoc);
            if (result.skipped) {
              skippedCount++;
              await fileDoc.ref.update({ needs_tagging: false });
            } else {
              taggedCount++;
            }
          } catch (fileErr) {
            batchErrors.push({ fileId: fileDoc.id, error: fileErr.message });
          }
        }

        return {
          success: true,
          taggedCount,
          skippedCount,
          totalProcessed: untagged.docs.length,
          hasMore: untagged.docs.length === BATCH_LIMIT,
          errors: batchErrors,
          message: `Tagged ${taggedCount} of ${untagged.docs.length} files (${skippedCount} skipped, no visual content)`,
        };
      }

      throw new functions.https.HttpsError(
        'invalid-argument',
        'mode must be "single" or "batch"'
      );
    } catch (err) {
      console.error('Tagging failed:', err);
      if (err instanceof functions.https.HttpsError) {
        throw err;
      }
      throw new functions.https.HttpsError('internal', err.message);
    }
  });

/**
 * Automatic tagging — this is the actual "system": it fires whenever a
 * /files/{fileId} document is written (scanner.cjs scanning a new folder,
 * a Drive sync, or an admin re-tag) with needs_tagging: true, and tags it
 * with zero manual steps. No batch script, no callable invocation — new
 * folders just get tagged as they're scanned in.
 *
 * Cost control: the Anthropic API is only ever called once per file. The
 * guard below exits before spending anything when needs_tagging isn't
 * freshly true, when the file was already vision-tagged, or (inside
 * tagOneFile) when there's no thumbnail/frame to look at.
 *
 * Loop safety: tagOneFile()'s own write sets needs_tagging: false, which
 * re-fires this trigger — but that second run's guard clause exits
 * immediately, so there is no infinite loop.
 */
exports.onFileNeedsTagging = functions
  // Firestore event triggers route through Eventarc, which requires the
  // function to live in the same region as the database — this project's
  // Firestore is europe-west1, while every other (HTTPS/callable) function
  // here defaults to us-central1. Those don't need this: they only reach
  // Firestore via the Admin SDK, which works cross-region fine. Only this
  // event-triggered function does.
  .region('europe-west1')
  .runWith({ secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 120, memory: '512MB' })
  .firestore.document('files/{fileId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after || after.needs_tagging !== true) return null;
    if (after.tagSource === 'claude-vision') return null;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    try {
      const result = await tagOneFile(anthropic, change.after);
      if (result.skipped) {
        await change.after.ref.update({ needs_tagging: false });
        console.log(`Skipped ${context.params.fileId} (no visual content)`);
      } else {
        console.log(`Tagged ${context.params.fileId}: ${result.tags.join(', ')}`);
      }
    } catch (err) {
      console.error(`Auto-tag failed for ${context.params.fileId}:`, err.message);
      // Clear the flag even on failure so a permanently-broken file (e.g. a
      // corrupt thumbnail) doesn't retry on every future write and rack up
      // failed API calls forever.
      await change.after.ref.update({ needs_tagging: false, tagError: err.message });
    }
    return null;
  });

// Exported for standalone testing (not used by the Cloud Function wrappers above).
exports._internal = { tagOneFile, buildImageBlocks, TAXONOMY_PROMPT };
