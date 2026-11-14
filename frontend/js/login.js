/* ============================================================
   login.js — sign in / register on one card.
   Matches the backend contract:
     register -> { username, email, password }  (username 3-30, pw >= 8)
     login    -> { login, password }            (login = username OR email)
   On success: store JWT + user, go to groups.html.
   ============================================================ */

(function () {
  if (Auth.token) { location.replace("groups.html"); return; }

  let mode = "signin"; // or "register"
  const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

  const el = {
    tabSignin: document.getElementById("tabSignin"),
    tabRegister: document.getElementById("tabRegister"),
    usernameField: document.getElementById("usernameField"),
    username: document.getElementById("username"),
    email: document.getElementById("email"),
    emailLabel: document.querySelector('label[for="email"]'),
    password: document.getElementById("password"),
    msg: document.getElementById("msg"),
    submitBtn: document.getElementById("submitBtn"),
    switchLink: document.getElementById("switchLink"),
    form: document.getElementById("authForm"),
  };

  function setMode(next) {
    mode = next;
    const reg = mode === "register";
    el.tabSignin.classList.toggle("on", !reg);
    el.tabRegister.classList.toggle("on", reg);
    el.tabSignin.setAttribute("aria-selected", String(!reg));
    el.tabRegister.setAttribute("aria-selected", String(reg));

    // register shows a username field + an email field; login shows one
    // identifier field (username OR email) sent as "login".
    el.usernameField.hidden = !reg;
    el.username.required = reg;
    el.email.type = reg ? "email" : "text";
    el.email.autocomplete = reg ? "email" : "username";
    el.email.placeholder = reg ? "you@example.com" : "Username or email";
    if (el.emailLabel) el.emailLabel.textContent = reg ? "Email" : "Username or email";
    el.password.autocomplete = reg ? "new-password" : "current-password";

    el.submitBtn.textContent = reg ? "Create account" : "Sign in";
    el.switchLink.innerHTML = reg
      ? "Already have an account? <b>Sign in</b>"
      : "New here? <b>Create an account</b>";
    el.msg.textContent = "";
    el.msg.className = "form-msg";
  }

  el.tabSignin.addEventListener("click", () => setMode("signin"));
  el.tabRegister.addEventListener("click", () => setMode("register"));
  el.switchLink.addEventListener("click", () => setMode(mode === "register" ? "signin" : "register"));

  function showError(text) {
    el.msg.textContent = text;
    el.msg.className = "form-msg error";
  }

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.msg.textContent = "";
    el.msg.className = "form-msg";

    const identifier = el.email.value.trim();   // email (register) or login (signin)
    const password = el.password.value;
    const username = el.username.value.trim();

    if (mode === "register") {
      if (!USERNAME_RE.test(username)) return showError("Username must be 3–30 letters, numbers or underscores.");
      if (!identifier) return showError("Please enter an email.");
      if (password.length < 8) return showError("Password must be at least 8 characters.");
    } else {
      if (!identifier || !password) return showError("Enter your username or email and password.");
    }

    el.submitBtn.disabled = true;
    el.submitBtn.textContent = mode === "register" ? "Creating…" : "Signing in…";

    try {
      let data;
      if (mode === "register") {
        data = await api.postPublic("/auth/register", { username, email: identifier, password });
      } else {
        data = await api.postPublic("/auth/login", { login: identifier, password });
      }
      Auth.save(data.token, data.user);
      location.replace("groups.html");
    } catch (err) {
      if (err.status === 429) showError("Too many attempts. Please wait a moment and try again.");
      else if (err.status === 409) showError("That username or email is already registered.");
      else if (err.status === 401) showError("Username or password is incorrect.");
      else if (err.status === 400) showError(err.message || "Please check your details.");
      else if (err.status === 0) showError("Cannot reach the server. Is the API running?");
      else showError(err.message || "Something went wrong. Please try again.");
      el.submitBtn.disabled = false;
      setMode(mode);
    }
  });

  setMode("signin");
})();
