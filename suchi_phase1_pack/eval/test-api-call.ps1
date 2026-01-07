# Test API call to check citation format
$body = @{
    channel = "web"
} | ConvertTo-Json

$sessionResponse = Invoke-WebRequest -Uri "https://suchi-api-lxiveognla-uc.a.run.app/v1/sessions" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
$session = $sessionResponse.Content | ConvertFrom-Json
$sessionId = $session.sessionId

Write-Host "Session ID: $sessionId" -ForegroundColor Green

$chatBody = @{
    sessionId = $sessionId
    channel = "web"
    userText = "I've had a cough for 6 weeks and I'm losing weight. I'm scared - what should I do?"
} | ConvertTo-Json

$chatResponse = Invoke-WebRequest -Uri "https://suchi-api-lxiveognla-uc.a.run.app/v1/chat" -Method POST -Body $chatBody -ContentType "application/json" -UseBasicParsing
$response = $chatResponse.Content | ConvertFrom-Json

Write-Host "`n=== API Response ===" -ForegroundColor Cyan
Write-Host "Has citations array: $($response.citations -ne $null)" -ForegroundColor Yellow
Write-Host "Citations count: $($response.citations.Count)" -ForegroundColor Yellow
Write-Host "Citation confidence: $($response.citationConfidence)" -ForegroundColor Yellow
Write-Host "`nCitations array:" -ForegroundColor Cyan
$response.citations | ConvertTo-Json -Depth 5
Write-Host "Response text (first 500 chars):" -ForegroundColor Cyan
if ($response.responseText.Length -gt 500) {
    Write-Host $response.responseText.Substring(0, 500)
} else {
    Write-Host $response.responseText
}
