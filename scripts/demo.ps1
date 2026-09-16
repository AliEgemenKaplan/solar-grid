# Solar Grid End-to-End Demo Script (PowerShell)

$BASE_SMART_METER = if ($env:SMART_METER_URL) { $env:SMART_METER_URL } else { "http://localhost:3001" }
$BASE_PRICING     = if ($env:PRICING_URL) { $env:PRICING_URL } else { "http://localhost:3002" }
$BASE_MATCHING    = if ($env:MATCHING_URL) { $env:MATCHING_URL } else { "http://localhost:3003" }
$BASE_BILLING     = if ($env:BILLING_URL) { $env:BILLING_URL } else { "http://localhost:3004" }

$RunId = if ($env:DEMO_RUN_ID) { $env:DEMO_RUN_ID } else { "$(Get-Date -Format 'yyyyMMddHHmmss')-$([Guid]::NewGuid().ToString('N').Substring(0, 6))" }
$SellerId = "HH-SELLER-$RunId"
$BuyerId = "HH-BUYER-$RunId"
$IdemSellerId = "HH-IDEM-SELLER-$RunId"
$IdemBuyerId = "HH-IDEM-BUYER-$RunId"
$CorrelationId = "demo-$RunId"

# The development defaults from infrastructure/docker-compose.yml.
$OperatorToken = if ($env:OPERATOR_API_TOKEN) { $env:OPERATOR_API_TOKEN } else { "dev-operator-token-not-for-production" }
$InternalToken = if ($env:INTERNAL_API_TOKEN) { $env:INTERNAL_API_TOKEN } else { "dev-internal-token-not-for-production" }

$PassCount = 0
$FailCount = 0

function Add-Pass {
    param([string]$Message)
    $script:PassCount++
    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Add-Fail {
    param([string]$Message)
    $script:FailCount++
    Write-Host "FAIL: $Message" -ForegroundColor Red
}

function Invoke-JsonApi {
    param(
        [string]$Method = "GET",
        [string]$Url,
        [object]$Body = $null,
        [string]$Token = $null
    )

    $headers = @{ "x-correlation-id" = $CorrelationId }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }

    $params = @{
        Method = $Method
        Uri = $Url
        Headers = $headers
        ErrorAction = "Stop"
    }

    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Depth 8)
    }

    try {
        return Invoke-RestMethod @params
    } catch {
        Write-Host "Request failed: $Method $Url - $($_.Exception.Message)" -ForegroundColor DarkYellow
        return $null
    }
}

Write-Host "Solar Grid End-to-End Demo"
Write-Host "Run ID: $RunId"
Write-Host "Smart Meter: $BASE_SMART_METER"
Write-Host "Pricing:     $BASE_PRICING"
Write-Host "Matching:    $BASE_MATCHING"
Write-Host "Billing:     $BASE_BILLING"
Write-Host ""

Write-Host "1. Health checks"
$services = @(
    @{ Name = "smart-meter"; Url = "$BASE_SMART_METER/health" },
    @{ Name = "pricing"; Url = "$BASE_PRICING/health" },
    @{ Name = "trade-matching"; Url = "$BASE_MATCHING/health" },
    @{ Name = "billing-ledger"; Url = "$BASE_BILLING/health" }
)

foreach ($svc in $services) {
    $response = Invoke-JsonApi -Url $svc.Url
    if ($response -and $response.status -eq "ok") {
        Add-Pass "$($svc.Name) health"
    } else {
        Add-Fail "$($svc.Name) health"
    }
}
Write-Host ""

Write-Host "2. Current price"
$price = Invoke-JsonApi -Url "$BASE_PRICING/prices/current"
if ($price) {
    Write-Host "Current price: $($price.pricePerKwh) $($price.currency)/kWh"
    Add-Pass "current price available"
} else {
    Add-Fail "current price available"
}
Write-Host ""

Write-Host "3. Seller reading"
$sellerReading = @{
    householdId = $SellerId
    productionKwh = 10
    consumptionKwh = 3
    timestamp = "2026-05-27T10:00:00.000Z"
}
$sellerResponse = Invoke-JsonApi -Method POST -Url "$BASE_SMART_METER/readings" -Body $sellerReading
if ($sellerResponse -and $sellerResponse.status -eq "SURPLUS") {
    Write-Host "Seller: $SellerId status=$($sellerResponse.status) surplusKwh=$($sellerResponse.surplusKwh)"
    Add-Pass "seller surplus reading"
} else {
    Add-Fail "seller surplus reading"
}
Write-Host ""

Write-Host "4. Buyer reading"
$buyerReading = @{
    householdId = $BuyerId
    productionKwh = 1
    consumptionKwh = 5
    timestamp = "2026-05-27T10:01:00.000Z"
}
$buyerResponse = Invoke-JsonApi -Method POST -Url "$BASE_SMART_METER/readings" -Body $buyerReading
if ($buyerResponse -and $buyerResponse.status -eq "DEMAND") {
    Write-Host "Buyer: $BuyerId status=$($buyerResponse.status) demandKwh=$($buyerResponse.demandKwh)"
    Add-Pass "buyer demand reading"
} else {
    Add-Fail "buyer demand reading"
}
Write-Host ""

Write-Host "5. Waiting for match"
$match = $null
for ($i = 0; $i -lt 20; $i++) {
    $matches = Invoke-JsonApi -Url "$BASE_MATCHING/matches?correlationId=$CorrelationId"
    if ($matches) {
        $match = @($matches.items) | Where-Object {
            $_.sellerHouseholdId -eq $SellerId -and $_.buyerHouseholdId -eq $BuyerId
        } | Select-Object -First 1
    }
    if ($match) { break }
    Start-Sleep -Seconds 1
}

if ($match -and $match.status -eq "COMPLETED") {
    Write-Host "Match: tradeId=$($match.tradeId) status=$($match.status) energyKwh=$($match.energyKwh)"
    Add-Pass "completed match created"
} else {
    Add-Fail "completed match created"
}
Write-Host ""

Write-Host "6. Balances"
$sellerBalance = Invoke-JsonApi -Url "$BASE_BILLING/balances/$SellerId"
if ($sellerBalance -and [double]$sellerBalance.balance -gt 0) {
    Write-Host "Seller balance: $($sellerBalance.balance)"
    Add-Pass "seller balance positive"
} else {
    Add-Fail "seller balance positive"
}

$buyerBalance = Invoke-JsonApi -Url "$BASE_BILLING/balances/$BuyerId"
if ($buyerBalance -and [double]$buyerBalance.balance -lt 0) {
    Write-Host "Buyer balance: $($buyerBalance.balance)"
    Add-Pass "buyer balance negative"
} else {
    Add-Fail "buyer balance negative"
}
Write-Host ""

Write-Host "7. Ledger entries"
$sellerLedger = Invoke-JsonApi -Url "$BASE_BILLING/ledger/$SellerId"
if ($sellerLedger -and (@($sellerLedger.items) | Where-Object { $_.entryType -eq "CREDIT" } | Select-Object -First 1)) {
    Add-Pass "seller CREDIT ledger entry visible"
} else {
    Add-Fail "seller CREDIT ledger entry visible"
}

$buyerLedger = Invoke-JsonApi -Url "$BASE_BILLING/ledger/$BuyerId"
if ($buyerLedger -and (@($buyerLedger.items) | Where-Object { $_.entryType -eq "DEBIT" } | Select-Object -First 1)) {
    Add-Pass "buyer DEBIT ledger entry visible"
} else {
    Add-Fail "buyer DEBIT ledger entry visible"
}
Write-Host ""

Write-Host "8. Billing idempotency"
$idemKey = "demo-idem-$RunId"
$idemTradeId = "TRD-DEMO-$RunId"
$tradeBody = @{
    tradeId = $idemTradeId
    sellerHouseholdId = $IdemSellerId
    buyerHouseholdId = $IdemBuyerId
    # Money and energy cross this boundary as decimal strings, not numbers.
    energyKwh = "2.000"
    pricePerKwh = "4.0000"
    totalAmount = "8.00"
    currency = "TRY"
    idempotencyKey = $idemKey
    correlationId = $CorrelationId
    completedAt = "2026-05-27T10:20:00.000Z"
}

# Recording a trade is a service-to-service call.
$null = Invoke-JsonApi -Method POST -Url "$BASE_BILLING/trades" -Body $tradeBody -Token $InternalToken
$second = Invoke-JsonApi -Method POST -Url "$BASE_BILLING/trades" -Body $tradeBody -Token $InternalToken
Write-Host "Duplicate response: $($second.duplicate)"
if ($second -and $second.duplicate -eq $true) {
    Add-Pass "duplicate idempotency check"
} else {
    Add-Fail "duplicate idempotency check"
}
Write-Host ""

Write-Host "9. Security and API contract"
function Get-StatusCode {
    param([string]$Method, [string]$Url, [string]$Token = $null, [object]$Body = $null)
    $headers = @{ "x-correlation-id" = $CorrelationId }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    $params = @{ Method = $Method; Uri = $Url; Headers = $headers; UseBasicParsing = $true; ErrorAction = "Stop" }
    if ($null -ne $Body) { $params.ContentType = "application/json"; $params.Body = ($Body | ConvertTo-Json -Depth 8) }
    try { return [int](Invoke-WebRequest @params).StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } return 0 }
}

function Assert-Status {
    param([string]$Label, [int]$Expected, [int]$Actual)
    Write-Host "$Label -> $Actual (expected $Expected)"
    if ($Actual -eq $Expected) { Add-Pass $Label } else { Add-Fail $Label }
}

Assert-Status "matching run without a token is refused" 401 (Get-StatusCode -Method POST -Url "$BASE_MATCHING/matching/run")
Assert-Status "matching run with the service token is forbidden" 403 (Get-StatusCode -Method POST -Url "$BASE_MATCHING/matching/run" -Token $InternalToken)
Assert-Status "matching run with the operator token is allowed" 200 (Get-StatusCode -Method POST -Url "$BASE_MATCHING/matching/run" -Token $OperatorToken)
Assert-Status "recording a trade without a token is refused" 401 (Get-StatusCode -Method POST -Url "$BASE_BILLING/trades" -Body $tradeBody)
Assert-Status "an oversized page is rejected" 400 (Get-StatusCode -Method GET -Url "$BASE_MATCHING/matches?limit=100000")

$conflictBody = $tradeBody.Clone()
$conflictBody.energyKwh = "3.000"
$conflictBody.totalAmount = "12.00"
Assert-Status "the same idempotency key with a different payload is a conflict" 409 (Get-StatusCode -Method POST -Url "$BASE_BILLING/trades" -Token $InternalToken -Body $conflictBody)
Write-Host ""

Write-Host "Summary: $PassCount passed, $FailCount failed"
if ($FailCount -gt 0) {
    exit 1
}
exit 0
