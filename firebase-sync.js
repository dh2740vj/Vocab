// Firebase 연결부
// firebase-config.js에 설정이 들어 있을 때만 동작합니다. 설정이 비어 있으면 앱은 이 기기에만 저장합니다.
// 화면과 동기화 규칙은 index.html의 '서버 동기화' 부분에 있고, 여기서는 Firebase 호출만 합니다.
//
// 데이터 위치 (Firestore, 모두 users/{로그인한 사람 uid} 아래)
//   decks, words, groups, days, cardStates   앱 데이터. 문서마다 syncAt(서버가 받은 시각)이 붙음
//   deletions/{종류__id}                      지움 표시 { kind, id, at(지운 시각), syncAt }. 5일 지나면 정리
//   reviewLogs                                채점 기록 (쓰기만 함)
//
// 사용량 줄이기: 앱을 열 때 전체를 읽지 않고, 지난번 이후 바뀐 문서(syncAt이 더 큰 것)만 받음.
// 삭제는 '바뀐 것만 받기'로 알 수 없어서 deletions에 지움 표시를 남김.
// syncAt은 기기 시계가 아니라 서버 시각(serverTimestamp)으로 찍음: 오프라인에서 고친 것이 한참 뒤에 올라가도
// '서버에 도착한 시각'이 찍혀서 다른 기기가 놓치지 않음.

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
    const tombId = (kind, id) => kind + '__' + id;

    sync.attach({
      version: 3,
      onUser: cb => A.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)),
      signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
      signUp: (email, pw) => A.createUserWithEmailAndPassword(auth, email, pw),
      signOut: () => A.signOut(auth),
      resetPassword: email => A.sendPasswordResetEmail(auth, email),

      // since가 있으면 syncAt이 since보다 큰 문서(그 뒤로 바뀐 것)만, 없으면 전체를 받음.
      // 바뀐 문서만 넘김. pending은 아직 서버가 확인하지 않은 쓰기
      listen(uid, kind, onSnap, onError, since) {
        const col = F.collection(fs, 'users', uid, kind);
        const q = since ? F.query(col, F.where('syncAt', '>', F.Timestamp.fromMillis(since))) : col;
        return F.onSnapshot(q, { includeMetadataChanges: true },
          snap => onSnap({
            fromCache: snap.metadata.fromCache,
            changes: snap.docChanges().map(c => ({
              type: c.type, id: c.doc.id, data: c.doc.data(), pending: c.doc.metadata.hasPendingWrites
            }))
          }),
          onError
        );
      },

      // ops: [{ kind, id, data | null(삭제), track }]
      //   track: 앱 데이터. 쓸 때 syncAt을 붙이고, 지울 때 지움 표시를 남기고, 다시 살릴 때 지움 표시를 걷음
      // 쓰기가 한 묶음 500개를 넘지 않게 200개씩 나눠서 씀. 오프라인이면 기기에 쌓였다가 연결되면 올라감
      commit(uid, ops) {
        const jobs = [], now = Date.now();
        for (let i = 0; i < ops.length; i += 200) {
          const batch = F.writeBatch(fs);
          ops.slice(i, i + 200).forEach(o => {
            const ref = F.doc(fs, 'users', uid, o.kind, o.id);
            const tomb = F.doc(fs, 'users', uid, 'deletions', tombId(o.kind, o.id));
            if (o.data) {
              batch.set(ref, o.track ? Object.assign({}, o.data, { syncAt: F.serverTimestamp() }) : o.data);
              if (o.track && o.untomb) batch.delete(tomb);
            } else {
              batch.delete(ref);
              if (o.track) batch.set(tomb, { kind: o.kind, id: o.id, at: now, syncAt: F.serverTimestamp() });
            }
          });
          jobs.push(batch.commit());
        }
        return Promise.all(jobs);
      },

      // 오래된 지움 표시 정리: syncAt이 before보다 이른 것을 지움. 지운 개수를 돌려줌
      // (예전 버전이 숫자 시각으로 남긴 표시도 함께 정리)
      async cleanup(uid, before) {
        const col = F.collection(fs, 'users', uid, 'deletions');
        const found = await Promise.all([F.Timestamp.fromMillis(before), before].map(v =>
          F.getDocsFromServer(F.query(col, F.where('syncAt', '<', v), F.limit(200)))));
        const docs = found.flatMap(snap => snap.docs);
        if (!docs.length) return 0;
        const batch = F.writeBatch(fs);
        docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        return docs.length;
      }
    });
  } catch (e) {
    console.warn('Firebase를 불러오지 못했어요', e);
    sync.failed();
  }
}
