// ==UserScript==
// @name         with Footprinter (PC / Android ver)
// @namespace    https://note.com/footprinter
// @version      2026-01-25
// @description  Tampermonkey loader(PC)
// @match        https://with.is/search*
// @match        https://with.is/users/*
// @match        https://with.is/groups/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://github.com/popaipoh-droid/with_extension/raw/refs/heads/main/with-Footprint.user.js
// @updateURL    https://github.com/popaipoh-droid/with_extension/raw/refs/heads/main/with-Footprint.user.js
// ==/UserScript==

(function () {
  "use strict";

  const BASE_URL =
    "https://with-footprint-pc-435226602223.asia-northeast1.run.app";

  const LS_LICENSE_KEY = "fp_with_license_key_v1";
  const LS_LAST_OK_VER = "fp_with_last_ok_version_v1";

  const FETCH_TIMEOUT_MS = 15000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isSearch = () => location.pathname.startsWith("/search");
  const isProfile = () => location.pathname.startsWith("/users/");
  const isGroups = () => location.pathname.startsWith("/groups/");

  // =========================
  // Androidの「最下部まで下がりきれない」問題の回避（方法①）
  //  - bodyのpadding-bottomを一瞬だけ増やすことで
  //    IntersectionObserver等のトリガーを発火させやすくする
  // =========================
  const isAndroid = () => /Android/i.test(navigator.userAgent || "");

  const ANDROID_NUDGE = {
    ENABLED: true,
    EXTRA_PX: 900,
    DURATION_MS: 800,
    NEAR_BOTTOM_PX: 80,
    THROTTLE_MS: 1200,
  };

  function nudgeViewport(extraPx = ANDROID_NUDGE.EXTRA_PX, durationMs = ANDROID_NUDGE.DURATION_MS) {
    const body = document.body;
    if (!body) return;

    const prevPadding = body.style.paddingBottom;

    body.style.paddingBottom = `${extraPx}px`;

    // 強制再計算（IntersectionObserver 再評価用）
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));

    setTimeout(() => {
      body.style.paddingBottom = prevPadding;
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
    }, durationMs);
  }

  function setupAndroidInfiniteScrollNudge() {
    if (!ANDROID_NUDGE.ENABLED) return;
    if (!isAndroid()) return;
    if (!isSearch()) return;

    let lastNudgeAt = 0;

    window.addEventListener(
      "scroll",
      () => {
        const now = Date.now();
        if (now - lastNudgeAt < ANDROID_NUDGE.THROTTLE_MS) return;

        const body = document.body;
        if (!body) return;

        const nearBottom =
          window.innerHeight + window.scrollY >=
          body.scrollHeight - ANDROID_NUDGE.NEAR_BOTTOM_PX;

        if (nearBottom) {
          lastNudgeAt = now;
          nudgeViewport();
        }
      },
      { passive: true },
    );
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }

  function getStoredToken() {
    return (localStorage.getItem(LS_LICENSE_KEY) || "").trim();
  }
  function setStoredToken(token) {
    try {
      localStorage.setItem(LS_LICENSE_KEY, (token || "").trim());
    } catch {}
  }
  function clearStoredToken() {
    try {
      localStorage.removeItem(LS_LICENSE_KEY);
    } catch {}
  }

  function alreadyInjected() {
    return !!window.__WITH_FP_ENGINE_INJECTED__;
  }
  function markInjected() {
    window.__WITH_FP_ENGINE_INJECTED__ = true;
  }

  async function injectEngine(code, label) {
    const blob = new Blob([code + `\n//# sourceURL=${label}\n`], {
      type: "text/javascript",
    });
    const url = URL.createObjectURL(blob);

    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = () => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
        resolve();
      };
      s.onerror = () => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
        reject(new Error("inject failed"));
      };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  async function fetchEngineJson(token) {
    const u = new URL(BASE_URL);
    u.searchParams.set("token", token || "");
    u.searchParams.set("platform", "tm");
    u.searchParams.set("_t", String(Date.now())); // cache buster

    const res = await withTimeout(
      fetch(u.toString(), { cache: "no-store" }),
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !json.ok || typeof json.code !== "string")
      throw new Error("invalid json");
    return json;
  }

  // =========================
  // UI（/search /groupsでのみ）
  //  - Trial時: バッジ + 「🔑 ライセンス入力」ボタン
  //  - Pro時  : バッジのみ（ボタン非表示）
  // =========================
  const UI = {
    WRAP_ID: "with-fp-license-ui-wrap",
    BTN_LICENSE_ID: "with-fp-btn-license",
    BADGE_ID: "with-fp-license-badge",
  };

  function badgeTextFromStored() {
    return getStoredToken() ? "Pro✅" : "Trial";
  }

  function setBadge(text) {
    const el = document.getElementById(UI.BADGE_ID);
    if (el) el.textContent = text;
  }

  function onBodyReady(cb) {
    if (document.body) return cb();
    const obs = new MutationObserver(() => {
      if (document.body) {
        obs.disconnect();
        cb();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function ensureLicenseUI() {
    if (!isSearch() && !isGroups()) return;

    // 既にUIがあるなら状態更新だけ
    const existing = document.getElementById(UI.WRAP_ID);
    if (existing) {
      setBadge(badgeTextFromStored());
      const btn = document.getElementById(UI.BTN_LICENSE_ID);
      if (btn) btn.style.display = getStoredToken() ? "none" : "inline-block";
      return;
    }

    const wrap = document.createElement("div");
    wrap.id = UI.WRAP_ID;
    Object.assign(wrap.style, {
      position: "fixed",
      bottom: "20px",
      left: "200px", // Trial開始ボタンの右横想定（必要なら調整）
      zIndex: 999999,
      display: "flex",
      gap: "10px",
      alignItems: "center",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    });

    const badge = document.createElement("div");

    const btn = document.createElement("button");
    btn.id = UI.BTN_LICENSE_ID;
    btn.textContent = "🔑 ライセンス入力";
    Object.assign(btn.style, {
      padding: "10px 12px",
      borderRadius: "10px",
      border: "none",
      fontWeight: "800",
      fontSize: "13px",
      cursor: "pointer",
      background: "#fbbf24",
      color: "#111",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    });

    btn.onclick = async () => {
      // ✅ ユーザー操作でprompt（document-start起因のブロックを回避）
      const input = (
        prompt("with Footprinter のライセンスキーを入力してください", "") || ""
      ).trim();

      if (!input) {
        alert("未入力のため反映しません（Trialのままです）");
        setBadge(badgeTextFromStored());
        return;
      }

      // 入力トークンでサーバ判定（proの時だけ保存）
      let payload;
      try {
        payload = await fetchEngineJson(input);
      } catch (e) {
        alert("通信エラーで確認できませんでした。\n\n" + (e?.message || e));
        return;
      }

      if (payload.plan === "pro") {
        setStoredToken(input);
        alert("✅ ライセンスキーを保存しました（Pro有効）");
        setBadge("Pro✅");
        // ✅ Proになったらボタン非表示
        btn.style.display = "none";
        // 次回から確実にProエンジンを注入するためリロード
        location.reload();
        return;
      }

      // trial判定＝不正
      alert("ライセンスキーが一致しません（trial版を起動します）");
      // ✅ 保存しない（汚さない）
      // clearStoredToken(); // 既存Proを消さない運用ならコメントアウトのままでOK
      setBadge("Trial");
    };

    wrap.appendChild(badge);
    wrap.appendChild(btn);

    (document.body || document.documentElement).appendChild(wrap);

    // ✅ 保存済みならボタンを隠す（普段はバッジのみ）
    if (getStoredToken()) btn.style.display = "none";
  }

  // =========================
  // main
  // =========================
  async function main() {
    if (alreadyInjected()) return;
    markInjected();

    // /search /groupsでUI表示（bodyが必要）
    onBodyReady(ensureLicenseUI);

    // Android検索ページの無限スクロール補助（bodyが必要）
    onBodyReady(setupAndroidInfiniteScrollNudge);

    // promptには頼らない：保存済みがあればPro、なければTrial
    const token = getStoredToken() || "";

    let payload;
    try {
      payload = await fetchEngineJson(token);
    } catch (e) {
      console.warn("[with FP Loader] fetch failed", e);
      alert(
        "エンジン取得に失敗しました。\n通信環境またはURL設定(BASE_URL)を確認してください。\n\n" +
          (e?.message || e),
      );
      return;
    }

    try {
      localStorage.setItem(LS_LAST_OK_VER, payload.version || "");
    } catch {}

    console.log("[with FP Loader] engine:", {
      plan: payload.plan,
      version: payload.version,
      log_endpoint: payload.log_endpoint,
      platform: payload.platform,
    });

    try {
      await injectEngine(
        payload.code,
        `with-fp-${payload.plan || "x"}-${payload.version || "x"}.js`,
      );
    } catch (e) {
      console.warn("[with FP Loader] inject failed", e);
      alert("エンジン実行に失敗しました。\n\n" + (e?.message || e));
    }
  }

  main();
})();
