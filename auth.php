<?php
require_once __DIR__ . '/config.php';

$_TOKENS_FILE = __DIR__ . '/tokens.json';

function isLoggedIn(): bool {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    if (!empty($_SESSION['authenticated'])) {
        return true;
    }
    return _checkRememberMe();
}

function requireAuth(): void {
    if (!isLoggedIn()) {
        // API requests get a JSON 401; page requests redirect to login
        $isApi = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json')
               || str_ends_with($_SERVER['SCRIPT_NAME'] ?? '', 'api.php');
        if ($isApi) {
            http_response_code(401);
            echo json_encode(['error' => 'unauthorized']);
            exit;
        }
        $redirect = urlencode($_SERVER['REQUEST_URI'] ?? '/');
        header("Location: /login.php?redirect=$redirect");
        exit;
    }
}

function doLogin(string $username, string $password, bool $remember): bool {
    if ($username !== AUTH_USERNAME || !password_verify($password, AUTH_PASSWORD_HASH)) {
        return false;
    }
    if (session_status() === PHP_SESSION_NONE) session_start();
    session_regenerate_id(true);
    $_SESSION['authenticated'] = true;

    if ($remember) {
        $token   = bin2hex(random_bytes(32));
        $hash    = hash_hmac('sha256', $token, AUTH_SECRET_KEY);
        $expires = time() + (REMEMBER_ME_DAYS * 86400);

        $tokens   = _loadTokens();
        $tokens[] = ['hash' => $hash, 'expires' => $expires];
        _saveTokens($tokens);

        setcookie('remember_token', $token, [
            'expires'  => $expires,
            'path'     => '/',
            'secure'   => true,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }
    return true;
}

function doLogout(): void {
    if (!empty($_COOKIE['remember_token'])) {
        $hash   = hash_hmac('sha256', $_COOKIE['remember_token'], AUTH_SECRET_KEY);
        $tokens = array_values(array_filter(_loadTokens(), fn($t) => $t['hash'] !== $hash));
        _saveTokens($tokens);
        setcookie('remember_token', '', [
            'expires'  => 1,
            'path'     => '/',
            'secure'   => true,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }
    if (session_status() === PHP_SESSION_NONE) session_start();
    $_SESSION = [];
    session_destroy();
}

function _checkRememberMe(): bool {
    if (empty($_COOKIE['remember_token'])) return false;

    $hash   = hash_hmac('sha256', $_COOKIE['remember_token'], AUTH_SECRET_KEY);
    $now    = time();
    $valid  = false;
    $tokens = array_values(array_filter(_loadTokens(), function ($t) use ($hash, $now, &$valid) {
        if ($t['hash'] === $hash && $t['expires'] > $now) {
            $valid = true;
        }
        return $t['expires'] > $now; // prune expired tokens while we're here
    }));
    _saveTokens($tokens);

    if ($valid) {
        if (session_status() === PHP_SESSION_NONE) session_start();
        $_SESSION['authenticated'] = true;
    }
    return $valid;
}

function _loadTokens(): array {
    global $_TOKENS_FILE;
    if (!file_exists($_TOKENS_FILE)) return [];
    return json_decode(file_get_contents($_TOKENS_FILE), true) ?? [];
}

function _saveTokens(array $tokens): void {
    global $_TOKENS_FILE;
    file_put_contents($_TOKENS_FILE, json_encode($tokens), LOCK_EX);
}
