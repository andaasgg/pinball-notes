<?php
require_once __DIR__ . '/auth.php';
doLogout();
header('Location: /login.php');
exit;
