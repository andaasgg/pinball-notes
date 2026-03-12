<?php
header('Content-Type: application/json');

$dataFile = __DIR__ . '/data.json';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo file_exists($dataFile) ? file_get_contents($dataFile) : '[]';

} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = file_get_contents('php://input');
    if (json_decode($body) !== null) {
        file_put_contents($dataFile, $body, LOCK_EX);
        echo '{"ok":true}';
    } else {
        http_response_code(400);
        echo '{"error":"invalid JSON"}';
    }
} else {
    http_response_code(405);
    echo '{"error":"method not allowed"}';
}
