<?php
declare(strict_types=1);

// PHP 8+ dengan extension cURL. Nilai environment tidak pernah dicetak.
function gatewayRequest(string $baseUrl, string $apiKey, string $route, ?array $body = null): array
{
    $url = parse_url($baseUrl);
    if (!$url || !in_array($url['scheme'] ?? '', ['http', 'https'], true) ||
        empty($url['host']) || isset($url['user']) || isset($url['pass']) ||
        isset($url['query']) || isset($url['fragment'])) {
        throw new InvalidArgumentException('Invalid gateway base URL');
    }
    if ($apiKey === '') throw new InvalidArgumentException('Gateway API key is required');
    $headers = ['Accept: application/json', 'x-api-key: ' . $apiKey];
    $handle = curl_init(rtrim($baseUrl, '/') . $route);
    $options = [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 20];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        $options[CURLOPT_POST] = true;
        $options[CURLOPT_POSTFIELDS] = json_encode($body, JSON_THROW_ON_ERROR);
    }
    $options[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($handle, $options);
    $raw = curl_exec($handle);
    $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    if ($raw === false) throw new RuntimeException('Gateway network error; outcome may be unknown. Do not retry creation automatically.');
    if ($status < 200 || $status >= 300) throw new RuntimeException('Gateway HTTP error: ' . $status);
    $result = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($result) || ($result['success'] ?? false) !== true || !isset($result['data'])) {
        throw new RuntimeException('Invalid gateway response');
    }
    return $result['data'];
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    $baseUrl = getenv('DANA_GATEWAY_URL') ?: '';
    $apiKey = getenv('DANA_GATEWAY_API_KEY') ?: '';
    $reference = $argv[1] ?? '';
    if ($baseUrl === '' || $apiKey === '' || $reference === '') {
        throw new RuntimeException('Set gateway environment variables and pass an order reference');
    }
    $qr = gatewayRequest($baseUrl, $apiKey, '/create-qris', ['amount' => 25000, 'reference_id' => $reference]);
    // Simpan qris_id, trx_id, amount, reference_id, expires_at di database order.
    echo json_encode(['trx_id' => $qr['trx_id'], 'qris_url' => $qr['qris_url']], JSON_THROW_ON_ERROR) . PHP_EOL;
    $payment = gatewayRequest($baseUrl, $apiKey, '/check-payment?trx_id=' . rawurlencode($qr['trx_id']));
    echo $payment['status'] . PHP_EOL;
}
