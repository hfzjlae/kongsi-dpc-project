/* ============================================================
   login.js — sign in / register on one card.
   On success: store JWT + user, go to groups.html.
   ============================================================ */

(function () {
  // already signed in? skip straight to groups
  if (Auth.token) { location.replace("groups.html"); return; }

  let mode = "signin"; // or "register"

  const el = {
    title: document.getElementById("title"),
    say: document.getElementById("say"),
    tabSignin: document.getElementById("tabSignin"),
    tabRegister: document.getElementById("tabRegister"),
    nameField: document.getElementById("nameField"),
    name: document.getElementById("name"),
    email: document.getElementById("email"),
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
    el.nameField.hidden = !reg;
    el.name.required = reg;
    el.submitBtn.textContent = reg ? "Create account" : "Sign in";
    el.password.autocomplete = reg ? "new-password" : "current-password";
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

    const email = el.email.value.trim();
    const password = el.password.value;
    const name = el.name.value.trim();

    if (!email || !password) return showError("Email and password are required.");
    if (mode === "register" && !name) return showError("Please enter your name.");
    if (mode === "register" && password.length < 6) return showError("Password must be at least 6 characters.");

    el.submitBtn.disabled = true;
    el.submitBtn.textContent = mode === "register" ? "Creating…" : "Signing in…";

    try {
      const path = mode === "register" ? "/auth/register" : "/auth/login";
      const payload = mode === "register" ? { name, email, password } : { email, password };
      const data = await api.postPublic(path, payload);
      Auth.save(data.token, data.user);
      location.replace("groups.html");
    } catch (err) {
      // friendly messages per status, no browser alert
      if (err.status === 429) showError("Too many attempts. Please wait a moment and try again.");
      else if (err.status === 409) showError("That email is already registered. Try signing in.");
      else if (err.status === 401) showError("Email or password is incorrect.");
      else if (err.status === 400) showError(err.message || "Please check your details.");
      else if (err.status === 0) showError("Cannot reach the server. Is the API running?");
      else showError(err.message || "Something went wrong. Please try again.");
      el.submitBtn.disabled = false;
      setMode(mode); // restores button label
    }
  });

  setMode("signin");
})();
