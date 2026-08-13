/* 서버 수명을 이 창에 묶는다 (2026-08-13).
 *
 * 화면이 열려 있는 동안 주기적으로 신호를 보내고, 닫힐 때 종료를 알린다.
 * 서버(app.py 워치독)는 신호가 끊기면 스스로 종료한다 — 콘솔 창이 없어져서
 * "창을 닫아 서버를 끄는" 방법이 사라졌기 때문에 필요한 장치다.
 *
 * app.js와 분리해 둔 이유: 사진대지 기능과 아무 상관이 없고, 나중에 데스크톱 앱
 * (창=프로세스)으로 바꾸면 이 파일만 통째로 빼면 되기 때문.
 */
(function () {
  var PING_INTERVAL = 5000;   // 서버 IDLE_TIMEOUT(20초)보다 충분히 짧게 — 한두 번 실패해도 안 끊기게
  var id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var payload = JSON.stringify({ id: id });
  var stopped = false;

  function ping() {
    if (stopped) return;
    fetch('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(function () { /* 서버가 이미 내려갔으면 조용히 넘어간다 */ });
  }

  function bye() {
    if (stopped) return;
    stopped = true;
    /* 창이 닫히는 순간에는 fetch가 취소되므로 sendBeacon을 쓴다.
       Blob으로 감싸야 Content-Type이 붙어 서버에서 JSON으로 읽을 수 있다. */
    try {
      navigator.sendBeacon('/api/bye', new Blob([payload], { type: 'application/json' }));
    } catch (e) { /* 지원 안 하면 워치독의 시간 초과에 맡긴다 */ }
  }

  ping();
  setInterval(ping, PING_INTERVAL);

  /* pagehide가 beforeunload보다 확실하다 — 모바일 사파리는 beforeunload를 안 부르는 경우가 있다.
     새로고침(F5)에서도 발동하지만, 서버가 IDLE_TIMEOUT(20초)만큼 기다려주므로
     그 사이에 새 페이지가 다시 ping을 보내면 종료되지 않는다. */
  window.addEventListener('pagehide', bye);
  window.addEventListener('beforeunload', bye);
})();
