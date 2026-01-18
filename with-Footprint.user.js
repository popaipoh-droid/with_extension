// ==UserScript==
// @name         with Footprinter (PC ver)
// @namespace    https://note.com/footprinter
// @version      2026-01-18
// @description  Tampermonkey loader(PC)
// @match        https://with.is/search*
// @match        https://with.is/users/*
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

  const SS_TRIAL_RUNNING = "wf_t_running";

  const FETCH_TIMEOUT_MS = 15000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isSearch = () => location.pathname.startsWith("/search");
  const isProfile = () => location.pathname.startsWith("/users/");

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

  function isTrialRunningNow() {
    try {
      return sessionStorage.getItem(SS_TRIAL_RUNNING) === "1";
    } catch {
      return false;
    }
    }

  // ✅ /search: 保存済みProキーがあれば prompt を出さない
  // ✅ /users: prompt を出さない（従来通り）
  function ensureTokenForThisPage() {
    // /users は絶対にpromptしない
    if (!isSearch()) {
      if (isProfile()) {
        console.log(
          "[with FP Loader] open /search to enter license key (loading Trial).",
        );
      }
      return getStoredToken() || ""; // 保存済みがあれば使う。なければTrial
    }

    // /search: すでにProキーが保存されていればそれを使う（promptしない）
    const stored = getStoredToken();
    if (stored) return stored;

    // /search: 未入力のみ prompt（空OK=Trial）
    const token = (
      prompt(
        "with Footprinter のライセンスキーを入力してください（空OK=Trial）",
        "",
      ) || ""
    ).trim();

    // Proキー入力時だけ保存（空は保存しない）
    if (token) setStoredToken(token);

    return token; // 空ならTrial
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
    u.searchParams.set("_t", String(Date.now()));

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

  async function main() {
    if (alreadyInjected()) return;
    markInjected();

    for (let i = 0; i < 40; i++) {
      if (document.documentElement) break;
      await sleep(50);
    }

    const token = ensureTokenForThisPage();

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
