$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$b1 = New-Object byte[] 32
$rng.GetBytes($b1)
$secret1 = -join ($b1 | ForEach-Object { $_.ToString('x2') })

$b2 = New-Object byte[] 32
$rng.GetBytes($b2)
$secret2 = -join ($b2 | ForEach-Object { $_.ToString('x2') })

Write-Output "AUTH_SECRET=$secret1"
Write-Output "ENCRYPTION_KEY=$secret2"
