# lighttpd 캐시 헤더 추가 — 빌드/플랫폼 요청서

> 작성: 2026-11-11 (프론트엔드)
> 대상: 빌드/플랫폼(`meta-swr`의 lighttpd 설정)
> 관련: 장치 `/etc/lighttpd/lighttpd.conf`

---

## 1. 무엇이 문제인가

웹 UI를 장치에 새로 올려도, 사용자 브라우저가 **예전 JS 파일을 계속 실행**합니다. 강력 새로고침(Ctrl+Shift+R)으로도 풀리지 않고, 브라우저 캐시를 지워야 풀립니다.

2026-11-11 실제로 생긴 일:

- 트렌드 화면 LIVE 갱신을 고친 `trends.js`를 장치에 올렸습니다(장치 파일 체크섬 일치 확인).
- 사용자 브라우저는 강력 새로고침 뒤에도 그래프가 멈춰 있었습니다.
- 장치에서 tcpdump로 보니 브라우저가 예전 코드만 쓰는 `GET /api/tfile/latest`를 계속 요청하고 있었습니다. 새 코드는 `/api/tfile/sample`을 씁니다.
- 브라우저 캐시를 지우자 바로 정상 동작했습니다.

## 2. 원인

- lighttpd가 정적 파일에 `Cache-Control` 헤더를 보내지 않습니다(`ETag`, `Last-Modified`만 보냄).
- 이 경우 브라우저는 스스로 정한 기간(보통 "파일이 마지막으로 바뀐 뒤 지난 시간의 10%") 동안 **서버에 묻지 않고** 캐시를 씁니다. 오래 안 바뀐 파일일수록 더 오래 캐시를 씁니다.
- 웹 UI는 화면별 JS(`trends.js`, `hmi.js` 등)를 페이지가 뜬 뒤 스크립트로 불러옵니다. 크롬의 강력 새로고침은 이렇게 불러오는 파일까지 캐시를 건너뛰지 않습니다.

이 문제는 웹 UI를 배포할 때마다 모든 화면, 모든 사용자에게 생길 수 있습니다.

## 3. 요청 사항

`lighttpd.conf` 끝에 아래를 추가해 주세요. `/api`를 뺀 모든 정적 파일(HTML·JS·CSS·이미지·글꼴)에 `Cache-Control: no-cache`를 붙입니다.

```lighttpd
# 웹 UI 정적 파일: 캐시는 쓰되 매번 바뀌었는지 확인(바뀌지 않았으면 304)
# — 웹 UI를 새로 배포하면 브라우저가 바로 새 파일을 받도록
server.modules += ( "mod_setenv" )
$HTTP["url"] !~ "^/api/" {
  setenv.add-response-header = ( "Cache-Control" => "no-cache" )
}
```

- `no-cache`는 "저장하지 말라"가 아니라 **"쓰기 전에 서버에 확인하라"**는 뜻입니다. 파일이 바뀌지 않았으면 lighttpd가 `304 Not Modified`(본문 없음)로 답하므로 전송량은 거의 늘지 않습니다.
- `/api`는 제외했습니다. API 응답의 헤더는 백엔드가 정합니다.
- 장치(lighttpd 1.4.82)에서 `lighttpd -tt -f <위 설정을 붙인 사본>`으로 설정 검사를 통과했습니다. `mod_setenv`는 lighttpd 본체에 들어 있어 **패키지를 추가할 필요가 없습니다**.
- 장치의 동작 중인 설정은 바꾸지 않았습니다.

## 4. 반영 후 확인 방법

```sh
# 1) 헤더가 붙는지
curl -sI http://192.168.0.150/js/trends.js | grep -i -E 'cache-control|etag'
#    → Cache-Control: no-cache 와 ETag 가 함께 나와야 함

# 2) 바뀌지 않은 파일은 304로 답하는지
ETAG=$(curl -sI http://192.168.0.150/js/trends.js | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" http://192.168.0.150/js/trends.js
#    → 304

# 3) API 응답에는 붙지 않는지(로그인 없이 401이어도 헤더 확인 가능)
curl -sI http://192.168.0.150/api/tfile/status | grep -i cache-control
#    → 출력 없음
```

## 5. 웹 쪽

- 웹 UI 코드는 바꾸지 않아도 됩니다.
- 반영 전까지는 웹을 배포한 뒤 사용자가 브라우저 캐시를 지워야 새 화면이 나옵니다(크롬: Ctrl+Shift+Delete → "캐시된 이미지 및 파일").
