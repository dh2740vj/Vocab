// srs.test.js — 간격 반복 스케줄러 단위 시험 (의존성 없음)
// 실행: node srs.test.js [index.html 경로]   (기본: 같은 폴더의 index.html)
// 앱 파일에서 /* SRS-START */ ~ /* SRS-END */ 블록만 잘라 내 시험함
const fs = require('fs'), path = require('path');
const file = process.argv[2] || path.join(__dirname, 'index.html');
const src = fs.readFileSync(file, 'utf8');
const a = src.indexOf('/* SRS-START'), b = src.indexOf('/* SRS-END */');
if (a < 0 || b < 0) { console.error('SRS 블록을 찾지 못했어요: ' + file); process.exit(1); }
const SRS = new Function(src.slice(a, b) + '\nreturn SRS;')();

let pass = 0, fail = 0;
function eq(actual, expected, name){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : `\n         기대: ${JSON.stringify(expected)}\n         결과: ${JSON.stringify(actual)}`));
}
const MIN = 60000, DAY = 86400000;
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();   // 로컬 시각
const fmtAll = (card, now) => { const p = SRS.previewIntervals(card, now); return SRS.RATINGS.map(r => SRS.formatInterval(p[r])); };
const NOON = at(2026, 11, 16, 12);

console.log('새 카드 첫 학습');
{
  const c = SRS.schedule(null, 'good', NOON);
  eq([c.state, c.step, c.due - NOON, c.reps], ['learning', 1, 10 * MIN, 1], '알맞음 → 학습 2단계, 10분 뒤');
  const again = SRS.schedule(null, 'again', NOON);
  eq([again.state, again.step, again.due - NOON], ['learning', 0, 1 * MIN], '다시 → 1단계, 1분 뒤');
  eq(fmtAll(null, NOON), ['1분', '6분', '10분', '4일'], '버튼별 시간: 1분 / 6분 / 10분 / 4일');
}

console.log('학습 단계 통과 후 졸업');
{
  let c = SRS.schedule(null, 'good', NOON);
  c = SRS.schedule(c, 'good', NOON + 10 * MIN);
  eq([c.state, c.interval, c.ease], ['review', 1, 2.5], '두 단계 통과 → 복습, 간격 1일');
  eq(c.due, at(2026, 11, 17, 4), '다음 날 새벽 4시부터 나옴');
}

console.log('쉬움으로 바로 졸업');
{
  const c = SRS.schedule(null, 'easy', NOON);
  eq([c.state, c.interval, c.due], ['review', 4, at(2026, 11, 20, 4)], '새 카드 쉬움 → 간격 4일');
  const l = SRS.schedule(SRS.schedule(null, 'good', NOON), 'easy', NOON);
  eq([l.state, l.interval], ['review', 4], '학습 중 쉬움 → 간격 4일');
}

console.log('복습 카드 채점');
{
  const rev = { state: 'review', interval: 10, ease: 2.5, due: NOON, step: 0, reps: 5, lapses: 0, lastReviewedAt: NOON - 10 * DAY };
  const h = SRS.schedule(rev, 'hard', NOON), g = SRS.schedule(rev, 'good', NOON), e = SRS.schedule(rev, 'easy', NOON);
  eq([h.interval, h.ease], [12, 2.35], '어려움: 10 × 1.2 = 12일, ease -0.15');
  eq([g.interval, g.ease], [25, 2.5], '알맞음: 10 × 2.5 = 25일');
  eq([e.interval, e.ease], [33, 2.65], '쉬움: 10 × 2.5 × 1.3 ≈ 33일, ease +0.15');
  eq(fmtAll(rev, NOON), ['10분', '12일', '25일', '1.1개월'], '버튼별 시간 표시');
  eq(SRS.formatInterval(63 * DAY), '2.1개월', '63일 → 2.1개월');
}

console.log('다시로 lapse');
{
  const rev = { state: 'review', interval: 10, ease: 2.5, due: NOON, step: 0, reps: 5, lapses: 0 };
  const c = SRS.schedule(rev, 'again', NOON);
  eq([c.state, c.lapses, c.ease, c.interval, c.due - NOON], ['relearning', 1, 2.3, 5, 10 * MIN], '다시 → 다시 배우기 10분, lapses+1, ease -0.2, 간격 절반');
  const back = SRS.schedule(c, 'good', NOON + 10 * MIN);
  eq([back.state, back.interval], ['review', 5], '다시 배우기 통과 → 줄어든 간격 5일로 복습');
  const one = SRS.schedule({ state: 'review', interval: 1, ease: 2.5 }, 'again', NOON);
  eq(one.interval, 1, '간격 1일에서 틀려도 최소 1일');
}

console.log('새벽 4시 하루 경계');
{
  eq(SRS.dayStart(at(2026, 11, 16, 3, 59)), at(2026, 11, 15, 4), '3:59는 전날 학습일');
  eq(SRS.dayStart(at(2026, 11, 16, 4, 0)), at(2026, 11, 16, 4), '4:00부터 새 학습일');
  const late = SRS.schedule(SRS.schedule(null, 'good', at(2026, 11, 16, 3, 20)), 'good', at(2026, 11, 16, 3, 30));
  eq(late.due, at(2026, 11, 16, 4), '새벽 3:30에 졸업 → 30분 뒤 4시에 이미 "다음 날"');
  const q = SRS.buildQueue([{ id: 'a', card: { state: 'review', due: at(2026, 11, 17, 4) } }], at(2026, 11, 17, 3, 59), { newLeft: 20, reviewLeft: 200 });
  eq(q.review, [], '3:59에는 아직 안 나옴');
  const q2 = SRS.buildQueue([{ id: 'a', card: { state: 'review', due: at(2026, 11, 17, 4) } }], at(2026, 11, 17, 4), { newLeft: 20, reviewLeft: 200 });
  eq(q2.review, ['a'], '4:00부터 나옴');
}

console.log('ease 최솟값 1.3');
{
  let c = { state: 'review', interval: 10, ease: 1.35, due: NOON };
  c = SRS.schedule(c, 'again', NOON);
  eq(c.ease, 1.3, '1.35에서 다시 → 1.3');
  c = SRS.schedule(c, 'good', NOON + 10 * MIN);
  c = SRS.schedule(c, 'hard', NOON + 6 * DAY);
  eq(c.ease, 1.3, '어려움을 눌러도 1.3 아래로 안 내려감');
}

console.log('복습 순서와 하루 개수');
{
  const now = NOON;
  const items = [
    { id: 'n1' }, { id: 'n2' }, { id: 'n3' },
    { id: 'r1', card: { state: 'review', due: now - DAY } },
    { id: 'r2', card: { state: 'review', due: now - 2 * DAY } },
    { id: 'l1', card: { state: 'learning', due: now - MIN } },
    { id: 'l2', card: { state: 'learning', due: now + 5 * MIN } },
    { id: 'f1', card: { state: 'review', due: now + 3 * DAY } },
  ];
  const q = SRS.buildQueue(items, now, { newLeft: 2, reviewLeft: 1 });
  eq([q.learn, q.review, q.fresh, q.ahead, q.later], [['l1'], ['r2'], ['n1', 'n2'], ['l2'], 1], '학습 중 → 오래 밀린 복습부터 → 새 단어, 하루 개수 제한');
}


console.log('시험 대비: 복습 간격 상한');
{
  const exam = at(2026, 11, 26, 4), capAt = at(2026, 11, 25, 4);       // 11/26 시험 → 11/25 새벽 4시까지
  const rev = { state: 'review', interval: 10, ease: 2.5, due: NOON };
  const g = SRS.schedule(rev, 'good', NOON, { capAt });
  eq([g.due, g.interval], [capAt, 9], '25일 뒤로 잡힐 복습 → 시험 전날로 당김 (간격 9일)');
  const easy = SRS.schedule(null, 'easy', NOON, { capAt });
  eq(easy.due, at(2026, 11, 20, 4), '시험 전날보다 이른 복습은 그대로 (4일)');
  const last = SRS.schedule(rev, 'good', at(2026, 11, 25, 9), { capAt });
  eq(last.interval, 25, '시험 전날 본 카드는 원래 일정대로 (시험 뒤로)');
  const pv = SRS.previewIntervals(rev, NOON, { capAt });
  eq(['hard', 'good', 'easy'].map(k => SRS.formatInterval(pv[k])), ['9일', '9일', '9일'], '버튼 시간도 상한 반영');
}

console.log('양방향 카드');
{
  const now = NOON, ds = SRS.dayStart(now);
  const fwdOld = { state: 'review', due: now + 3 * DAY, firstAt: ds - DAY };
  const fwdToday = { state: 'learning', due: now + 10 * MIN, firstAt: ds + MIN };
  const items = [
    { id: 'a' }, { id: 'a:r', after: undefined },
    { id: 'b', card: fwdOld }, { id: 'b:r', after: fwdOld },
    { id: 'c', card: fwdToday }, { id: 'c:r', after: fwdToday },
  ];
  items[1].after = null;
  const q = SRS.buildQueue(items, now, { newLeft: 20, reviewLeft: 200 });
  eq(q.fresh, ['b:r', 'a'], '뜻→단어는 단어→뜻을 전날까지 본 단어만 (a:r, c:r은 대기)');
  const q2 = SRS.buildQueue(items, now, { newLeft: 20, reviewLeft: 200, sameDay: true });
  eq(q2.fresh, ['b:r', 'a', 'c:r'], '시험 막바지(sameDay)에는 오늘 본 단어도 바로');
}

console.log(`\n${pass}개 통과, ${fail}개 실패`);
process.exit(fail ? 1 : 0);
