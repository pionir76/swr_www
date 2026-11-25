# 색 선택 창 (color-picker)

색 판 · 색상 바 · 투명도 바 · 8자리 값(`#RRGGBBAA`) · R G B A 숫자 · [Cancel] / [OK]. 제목 줄("Color picker")을 잡고 끌면 창이 움직인다.
화면에 보이는 글자는 영어로 통일했다(어느 언어의 프로젝트에 넣어도 번역 없이 쓰도록).
다른 코드에 기대지 않는다. 이 폴더의 `color-picker.js`와 `color-picker.css`만 있으면 된다.

## 넣기

```html
<script src="components/color-picker/color-picker.js"></script>
```

스타일(`color-picker.css`)은 스크립트가 자기 옆에서 스스로 불러온다. 스크립트를 코드로 불러와도 된다(같은 폴더 기준으로 CSS를 찾는다).

## 쓰기

```js
const start = '#ff8800cc';
ColorPicker.open(buttonEl, {
  value: start,          // '#rrggbb' 또는 '#rrggbbaa'
  alpha: true,           // false면 투명도 바·A 칸 없이
  onInput: (v) => preview(v),        // 끄는 동안·입력할 때마다
  onChange: (v) => {},               // 한 번의 조작이 끝났을 때(마우스를 놓음, 입력 확정)
  onClose: (ok) => { if (!ok) preview(start); },   // ok=false면 취소 — 처음 값으로 되돌리는 것은 부르는 쪽 몫
});
```

| 함수 | 설명 |
|---|---|
| `ColorPicker.open(anchor, opts)` | `anchor` 요소 아래에 창을 띄운다(자리가 없으면 위·왼쪽). 이미 열린 창은 확인으로 닫는다 |
| `ColorPicker.close(ok)` | 닫는다. `ok === false`일 때만 취소 |
| `ColorPicker.isOpenFor(anchor)` | 그 요소로 연 창이 떠 있는지 |
| `ColorPicker.show(v)` | 표시용 글자 `#RRGGBBAA`(대문자 8자리) |
| `ColorPicker.parse(v)` | `{ r, g, b, a }`(a는 0~100) 또는 `null` |

## 동작

- 돌려주는 값은 투명도 100%면 `#rrggbb`, 미만이면 `#rrggbbaa`(소문자).
- 확인: [OK], 창 바깥 클릭, Enter, 창 크기 변경. 취소: [Cancel], Esc.
- 끄는 동안 `onInput`으로 계속 알린다(미리보기). 취소해도 부품이 값을 되돌려 주지는 않는다 — `onClose(false)`에서 부르는 쪽이 되돌린다.
- 창 위치는 기억하지 않는다. 전체 화면 중이면 전체 화면 요소 안에 붙는다.
- 투명도는 %(0~100)로 다룬다. 8자리 값의 끝 두 자리가 %로 딱 떨어지지 않으면 가장 가까운 %로 맞춰진다.

## 색 바꾸기

`color-picker.css` 맨 위 `.cpk`의 변수(`--cpk-bg`, `--cpk-line`, `--cpk-accent` 등)를 고친다.
