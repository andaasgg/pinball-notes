<?php
require_once __DIR__ . '/auth.php';

if (isLoggedIn()) {
    header('Location: /');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    $remember = !empty($_POST['remember']);

    if (doLogin($username, $password, $remember)) {
        $redirect = $_GET['redirect'] ?? '/';
        // Ensure redirect stays on-site
        if (!str_starts_with($redirect, '/')) $redirect = '/';
        header('Location: ' . $redirect);
        exit;
    }
    $error = 'Invalid username or password.';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#1a1a1a">
  <title>Pinball Notes – Sign In</title>
  <link rel="stylesheet" href="style.css">
  <style>
    .login-wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .login-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px 24px;
      width: 100%;
      max-width: 380px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .login-title {
      text-align: center;
      font-size: 22px;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.5px;
    }
    .login-subtitle {
      text-align: center;
      font-size: 13px;
      color: var(--text-muted);
      margin-top: -12px;
    }
    .login-error {
      background: rgba(192,57,43,0.15);
      border: 1px solid var(--danger);
      border-radius: var(--radius);
      color: var(--danger);
      font-size: 14px;
      padding: 10px 12px;
      text-align: center;
    }
    .remember-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 15px;
      color: var(--text-muted);
      cursor: pointer;
    }
    .remember-row input[type="checkbox"] {
      width: 18px;
      height: 18px;
      accent-color: var(--accent);
      flex-shrink: 0;
    }
    .btn-login {
      width: 100%;
      padding: 14px;
      background: var(--accent);
      color: #000;
      border: none;
      border-radius: var(--radius);
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-login:active { background: var(--accent-light); }
    .form-fields { display: flex; flex-direction: column; gap: 16px; }
  </style>
</head>
<body>
  <div class="login-wrap">
    <div class="login-card">
      <div>
        <div class="login-title">Pinball Notes</div>
        <div class="login-subtitle">Tournament reference tool</div>
      </div>

      <?php if ($error): ?>
        <div class="login-error"><?= htmlspecialchars($error) ?></div>
      <?php endif; ?>

      <form method="POST" autocomplete="on">
        <div class="form-fields">
          <div class="field-group">
            <label class="field-label" for="username">Username</label>
            <input
              class="field-input"
              type="text"
              id="username"
              name="username"
              autocomplete="username"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              value="<?= htmlspecialchars($_POST['username'] ?? '') ?>"
              required
            >
          </div>
          <div class="field-group">
            <label class="field-label" for="password">Password</label>
            <input
              class="field-input"
              type="password"
              id="password"
              name="password"
              autocomplete="current-password"
              required
            >
          </div>
          <label class="remember-row">
            <input type="checkbox" name="remember" value="1" checked>
            Stay signed in for 30 days
          </label>
          <button class="btn-login" type="submit">Sign In</button>
        </div>
      </form>
    </div>
  </div>
</body>
</html>
