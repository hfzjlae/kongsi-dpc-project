// ------------------------------------------------------------------
// login.js — sign in and create account (index.html)
// ------------------------------------------------------------------
if (getToken()) window.location.href = 'groups.html'; // already signed in

const message = document.getElementById('message');
const signInForm = document.getElementById('signInForm');
const registerForm = document.getElementById('registerForm');
const tabSignIn = document.getElementById('tabSignIn');
const tabRegister = document.getElementById('tabRegister');

function showTab(which) {
  const isSignIn = which === 'signin';
  tabSignIn.setAttribute('aria-selected', String(isSignIn));
  tabRegister.setAttribute('aria-selected', String(!isSignIn));
  signInForm.hidden = !isSignIn;
  registerForm.hidden = isSignIn;
  showMessage(message, '');
}
tabSignIn.addEventListener('click', () => showTab('signin'));
tabRegister.addEventListener('click', () => showTab('register'));

signInForm.addEventListener('submit', async (event) => {
  event.preventDefault(); // stop the browser reloading the page
  const button = signInForm.querySelector('button');
  button.disabled = true;
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      json: {
        login: document.getElementById('login').value,
        password: document.getElementById('loginPassword').value,
      },
    });
    saveSession(data.token, data.user);
    window.location.href = 'groups.html';
  } catch (err) {
    showMessage(message, err.message);
  } finally {
    button.disabled = false;
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = registerForm.querySelector('button');
  button.disabled = true;
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      json: {
        username: document.getElementById('username').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      },
    });
    saveSession(data.token, data.user);
    window.location.href = 'groups.html';
  } catch (err) {
    showMessage(message, err.message);
  } finally {
    button.disabled = false;
  }
});
