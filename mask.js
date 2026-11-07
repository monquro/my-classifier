/* 가림 — AI에 보내기 전에, 브라우저 안에서 개인정보를 가린다.
 * 가리는 것: 이름 · 전화번호 · 이메일 · 영수증/주문 번호 (criteria.json 의 mask)
 * 자동 가림은 완벽하지 않다. 놓치는 것은 채점과 직접 넣어 보기로 찾는다.
 * 브라우저(window.Mask)와 node(require) 둘 다에서 쓴다. */
(function (root) {
  "use strict";

  // 흔한 성씨 + 두 글자, 뒤에 «인데요 · 입니다 · 님» 같은 말이 올 때만 이름으로 본다
  const SURNAMES = "김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모";

  const PATTERNS = [
    { type: "이메일", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
    { type: "전화번호", re: /01[016789][- ]?\d{3,4}[- ]?\d{4}/g },
    { type: "전화번호", re: /\(?\b\d{3}\)?[- .]\d{3}[- .]\d{4}\b/g },
    { type: "주문번호", re: /\b[A-Z]{2,4}-\d{4,}\b/g },
    { type: "주문번호", re: /(?<=(?:주문|영수증)\s?번호\s?[:#]?\s?)[A-Za-z0-9-]{4,}/g },
    { type: "이름", re: new RegExp(`(?<![가-힣])[${SURNAMES}][가-힣]{2}(?=\\s?(?:인데요|입니다|이에요|예요|님|고객|씨))`, "g") },
  ];

  function mask(text) {
    let out = String(text || "");
    const found = [];
    for (const p of PATTERNS) {
      out = out.replace(p.re, m => { found.push({ type: p.type, value: m }); return `[${p.type}]`; });
    }
    return { masked: out, found };
  }

  const api = { mask };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Mask = api;
})(this);
