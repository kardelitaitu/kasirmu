// API base: use relative path when hosted on kasir.mu subdomains (Worker API proxy)
// to eliminate CORS and in-handler origin restrictions. Fall back to direct backend URL locally.
const isSubdomain = window.location.hostname.endsWith('kasir.mu');
const API = isSubdomain
  ? ''
  : ((window.__OZ_CONFIG__ && window.__OZ_CONFIG__.licenseApiUrl) || 'https://license.kasir.mu');

let currentMode = 'otp'; // default to 'otp' since admin accounts start without a password
// B18: the OTP cooldown timer is no longer a module global — it lives on
// the cooldown node via admin-utils.startCountdown (see startOtpCooldown).

function showError(msg) {
  hideSuccess();
  const e = document.getElementById('error-msg');
  if (e) {
    e.textContent = msg;
    e.classList.remove('hidden');
  }
}

function hideError() {
  const e = document.getElementById('error-msg');
  if (e) e.classList.add('hidden');
}

function showSuccess(msg) {
  hideError();
  const e = document.getElementById('success-msg');
  if (e) {
    e.textContent = msg;
    e.classList.remove('hidden');
  }
}

function hideSuccess() {
  const e = document.getElementById('success-msg');
  if (e) e.classList.add('hidden');
}

function setLoading(l, msg) {
  const formEl = document.getElementById('login-form');
  const loadingEl = document.getElementById('loading-state');
  if (formEl) formEl.style.display = l ? 'none' : 'block';
  if (loadingEl) {
    loadingEl.style.display = l ? 'block' : 'none';
    if (msg) {
      const textEl = loadingEl.querySelector('.loading-text');
      if (textEl) textEl.textContent = msg;
    }
  }
}

function setAuthMode(mode) {
  // B21 fix: the mode logic now lives in admin-utils.setAuthMode
  // (unit-tested), with an in-flight veto — clicking the other tab while
  // a login request is pending used to flip currentMode under the
  // response handler, which then wrote the wrong mode's button label and
  // could start the OTP cooldown on the password tab. A refused flip
  // leaves the form exactly as it was until the request settles.
  const els = {
    tabOtp: document.getElementById('tab-otp'),
    tabPwd: document.getElementById('tab-password'),
    pwdGroup: document.getElementById('password-group'),
    otpGroup: document.getElementById('otp-group'),
    loginBtn: document.getElementById('login-btn'),
    cd: document.getElementById('otp-cooldown'),
  };
  if (!window.AdminUtils.setAuthMode(mode, els, { isSubmitting: () => isSubmitting })) return;
  currentMode = mode;
  hideError();
  hideSuccess();
}

function startOtpCooldown(seconds = 60) {
  const cd = document.getElementById('otp-cooldown');
  if (!cd) return;
  cd.classList.remove('hidden');
  // B18 fix: timer now tracked on the node via admin-utils.startCountdown
  // (the old module-global otpTimer kept running when setAuthMode hid the
  // element, and switching back never re-showed it — a live server-side
  // resend cooldown ran invisibly until the user walked into a 429).
  startCountdown(cd, seconds,
    (s) => t('login.resendIn') + s + t('login.seconds'),
    () => { cd.textContent = t('login.resendPrompt'); });
}

// ── Exchange token for a one-time code (hardening F1) ──────────
async function exchangeForCode(token) {
  const res = await fetch(API + '/api/v1/web/exchange-issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
  });
  if (!res.ok) throw new Error('exchange failed');
  const body = await res.json();
  // B13 fix: validated via admin-utils.exchangeUrlFrom — the old code
  // navigated to /?code=undefined when the response lacked a code,
  // producing a silent login redirect loop with no error shown.
  window.location.href = exchangeUrlFrom(body);
}

let isSubmitting = false;

async function handleLogin() {
  if (isSubmitting) return;
  // B22 fix: the button is type=submit inside the form — Enter in any
  // text input triggers IMPLICIT form submission regardless of the
  // button's disabled state (HTML only blocks clicks on disabled
  // buttons). Without this guard, the 429 lockout countdown was pure
  // theatre: press Enter and keep hammering the rate limiter.
  if (isLockoutActive(document.getElementById('login-btn'))) return;
  isSubmitting = true;
  hideError();
  hideSuccess();

  try {
    const email = document.getElementById('email').value.trim();
    if (!email) {
      showError(t('login.enterEmail'));
      document.getElementById('email').focus();
      return;
    }

    if (currentMode === 'otp') {
      const otpGroup = document.getElementById('otp-group');
      const isCodePromptVisible = otpGroup && !otpGroup.classList.contains('hidden');

      if (!isCodePromptVisible) {
        // Step 1: Request OTP code
        setLoading(true, t('login.sendingCode'));
        try {
          const res = await fetch(API + '/api/v1/web/request-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const body = await res.json();
          if (res.status === 200) {
            otpGroup.classList.remove('hidden');
            document.getElementById('login-btn').textContent = t('login.verifyCode');
            showSuccess(t('login.codeSent'));
            startOtpCooldown(60);
            setLoading(false);
            const otpInput = document.getElementById('otp-code');
            if (otpInput) otpInput.focus();
            return;
          }
          if (res.status === 429) {
            showLockoutCountdown(body.retry_after || 60);
            setLoading(false);
            return;
          }
          if (res.status === 403) {
            showError(body.error || t('login.accessDeniedOrigin'));
            setLoading(false);
            return;
          }
          if (res.status === 503) {
            showError(t('login.emailDeliveryNotConfigured'));
            setLoading(false);
            return;
          }
          showError(body.error || t('login.failedToSendCode'));
        } catch (err) {
          showError(t('login.couldNotConnect'));
        }
        setLoading(false);
        return;
      }

      // Step 2: Verify OTP code
      const code = document.getElementById('otp-code').value.trim();
      if (!code) {
        showError(t('login.enterCode'));
        document.getElementById('otp-code').focus();
        return;
      }
      setLoading(true, t('login.verifyingCode'));
      try {
        const res = await fetch(API + '/api/v1/web/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code })
        });
        const body = await res.json();
        if (res.status === 200 && body.token) {
          showSuccess(t('login.codeVerified'));
          await exchangeForCode(body.token);
          return;
        }
        if (res.status === 429) {
          showLockoutCountdown(body.retry_after || 60);
          setLoading(false);
          return;
        }
        if (res.status === 403) {
          showError(body.error || t('login.accessDeniedOrigin'));
          setLoading(false);
          return;
        }
        showError(body.error || t('login.invalidOrExpiredCode'));
      } catch (err) {
        showError(err && err.exchangeFailed ? t('login.exchangeFailed') : t('login.couldNotConnect'));
      }
      setLoading(false);
      return;
    }

    // Password login
    const password = document.getElementById('password').value;
    if (!password) {
      showError(t('login.enterPassword'));
      document.getElementById('password').focus();
      return;
    }
    setLoading(true, t('login.signingIn'));
    try {
      const res = await fetch(API + '/api/v1/web/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const body = await res.json();
      if (res.status === 200 && body.token) {
        showSuccess(t('login.signingInNow'));
        await exchangeForCode(body.token);
        return;
      }
      if (res.status === 429) {
        const retryAfter = body.retry_after || 60;
        showLockoutCountdown(retryAfter);
        setLoading(false);
        return;
      }
      if (res.status === 403) {
        showError(body.error || t('login.accessDeniedOrigin'));
        setLoading(false);
        return;
      }
      showError(body.error || t('login.invalidEmailOrPassword'));
    } catch (err) {
      showError(t('login.couldNotConnect'));
    }
    setLoading(false);
  } finally {
    isSubmitting = false;
  }
}

// ── Lockout countdown (429 with retry_after) ─────────────────
function showLockoutCountdown(seconds) {
  const btn = document.getElementById('login-btn');
  // B7 fix: delegates to admin-utils.startLockoutCountdown, which keeps
  // one tracked timer per button. The old inline version created a NEW
  // setInterval per 429 without clearing the previous one, so a second
  // rate-limited response left two timers racing: the shorter one
  // re-enabled the button early and the other zombie-rewrote the label.
  startLockoutCountdown(
    btn, seconds,
    function (s) { return t('login.tryAgainIn') + s + t('login.seconds'); },
    function () {
      // Restore the label the mode's own rules would show: in OTP mode
      // the label depends on whether the code input is already visible
      // (Verify vs Send), and the password label must match setAuthMode
      // exactly — the old version said 'Sign In' on a tab whose button
      // otherwise reads 'Sign In with Password'.
      if (currentMode !== 'otp') return t('login.signInPassword');
      const og = document.getElementById('otp-group');
      return og && !og.classList.contains('hidden') ? t('login.verifyCode') : t('login.sendCode');
    }
  );
}

// Wire single submit event on form
const form = document.getElementById('auth-form');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleLogin();
  });
}

// Wire mode tabs (no inline handlers — strict CSP)
const tabOtp = document.getElementById('tab-otp');
const tabPwd = document.getElementById('tab-password');
if (tabOtp) tabOtp.addEventListener('click', () => setAuthMode('otp'));
if (tabPwd) tabPwd.addEventListener('click', () => setAuthMode('password'));

// Theme toggle (theme.js is loaded in <head>)
const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    if (window.__ozAdminTheme) { window.__ozAdminTheme.toggle(); }
  });
}

// Initialize default mode
setAuthMode('otp');
