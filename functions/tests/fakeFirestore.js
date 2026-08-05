/**
 * Minimal in-memory Firestore double used by unit tests.
 * Mirrors just the surface JobManager relies on:
 *   db.collection(name).doc(id?).set(data) / .update(data) / .get()
 */
function createFakeFirestore() {
  const collections = new Map();
  let counter = 0;

  function getCollection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  return {
    collection(name) {
      const col = getCollection(name);
      return {
        doc(id) {
          const docId = id || `fake-doc-${++counter}`;
          return {
            id: docId,
            async set(data) {
              col.set(docId, { ...data });
            },
            async update(data) {
              if (!col.has(docId)) {
                throw new Error(`No document to update: ${docId}`);
              }
              col.set(docId, { ...col.get(docId), ...data });
            },
            async get() {
              const data = col.get(docId);
              return {
                exists: data !== undefined,
                id: docId,
                data: () => data,
              };
            },
          };
        },
      };
    },
  };
}

module.exports = { createFakeFirestore };
