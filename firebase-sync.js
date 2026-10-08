// Firebase 연결부
// firebase-config.js에 설정이 들어 있을 때만 동작합니다. 설정이 비어 있으면 앱은 이 기기에만 저장합니다.
// 화면과 동기화 규칙은 index.html의 '서버 동기화' 부분에 있고, 여기서는 Firebase 호출만 합니다.
//
// 데이터 위치 (Firestore)
//   users/{로그인한 사람 uid}/decks/{단어장 id}   name, lang, createdAt, updatedAt
//   users/{로그인한 사람 uid}/words/{단어 id}     deckId, term, meaning, example, box, nextReview, correct, wrong, unknown, createdAt, updatedAt
//   users/{로그인한 사람 uid}/groups/{그룹 id}    name, examDate, deckIds, createdAt, updatedAt

const VERSION = '10.14.1';
const BASE = `https://www.gstatic.com/firebasejs/${VERSION}/`;
const config = window.VOCAB_FIREBASE_CONFIG;
const sync = window.VocabSync;

if (config && sync) {
  try {
    const [{ initializeApp }, A, F] = await Promise.all([
      import(BASE + 'firebase-app.js'),
      import(BASE + 'firebase-auth.js'),
      import(BASE + 'firebase-firestore.js')
    ]);
    const app = initializeApp(config);
    const auth = A.getAuth(app);

    // 오프라인 저장소: 인터넷이 끊겨도 읽고 쓸 수 있고, 연결되면 자동으로 서버와 맞춤
    let fs;
    try {
      fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
    } catch (e) {
      console.warn('오프라인 저장소를 쓸 수 없어 메모리 저장소로 동작해요', e);
      fs = F.getFirestore(app);
    }

    sync.attach({
      onUser: cb => A.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)),
      signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
      signUp: (email, pw) => A.createUserWithEmailAndPassword(auth, email, pw),
      signOut: () => A.signOut(auth),
      resetPassword: email => A.sendPasswordResetEmail(auth, email),

      // kind: 'decks' | 'words' | 'groups'. 바뀐 문서만 넘김. pending은 이 기기가 쓰고 아직 서버가 확인하지 않은 문서
      listen(uid, kind, onSnap, onError) {
        return F.onSnapshot(
          F.collection(fs, 'users', uid, kind),
          { includeMetadataChanges: true },
          snap => onSnap({
            fromCache: snap.metadata.fromCache,
            changes: snap.docChanges().map(c => ({
              type: c.type, id: c.doc.id, data: c.doc.data(), pending: c.doc.metadata.hasPendingWrites
            }))
          }),
          onError
        );
      },

      // ops: [{ kind, id, data | null(삭제) }]
      // 한 번에 400개씩 묶어서 씀. 오프라인이면 기기에 쌓였다가 연결되면 올라감
      commit(uid, ops) {
        const jobs = [];
        for (let i = 0; i < ops.length; i += 400) {
          const batch = F.writeBatch(fs);
          ops.slice(i, i + 400).forEach(o => {
            const ref = F.doc(fs, 'users', uid, o.kind, o.id);
            if (o.data) batch.set(ref, o.data); else batch.delete(ref);
          });
          jobs.push(batch.commit());
        }
        return Promise.all(jobs);
      }
    });
  } catch (e) {
    console.warn('Firebase를 불러오지 못했어요', e);
    sync.failed();
  }
}
