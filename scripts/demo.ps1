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

# The tokens the stack was started with: from the environment when set there,
# otherwise from infrastructure/.env (created by `pnpm env:init`). They are
# sent with requests and never printed.
$EnvFile = Join-Path (Split-Path -Parent $PSScriptRoot) "infrastructure/.env"
function Get-EnvFileValue {
    param([string]$Name)
    if (-not (Test-Path $EnvFile)) { return $null }
    $line = Get-Content $EnvFile | Where-Object { $_ -like "$Name=*" } | Select-Object -Last 1
    if ($line) { return $line.Substring($Name.Length + 1).Trim() }
    return $null
}
$OperatorToken = if ($env:OPERATOR_API_TOKEN) { $env:OPERATOR_API_TOKEN } else { Get-EnvFileValue "OPERATOR_API_TOKEN" }
$InternalToken = if ($env:INTERNAL_API_TOKEN) { $env:INTERNAL_API_TOKEN } else { Get-EnvFileValue "INTERNAL_API_TOKEN" }
if (-not $OperatorToken -or -not $InternalToken) {
    Write-Host "ERROR: OPERATOR_API_TOKEN and INTERNAL_API_TOKEN are neither set nor in $EnvFile." -ForegroundColor Red
    Write-Host "Run 'pnpm env:init' before starting the stack."
    exit 1
}

# Readings and the recorded trade are timestamped as the demo runs, so they
# land in the dashboard's recent windows rather than on a fixed date.
function Get-UtcMinutesAgo {
    param([int]$Minutes)
    return (Get-Date).ToUniversalTime().AddMinutes(-$Minutes).ToString("yyyy-MM-dd'T'HH:mm:ss'.000Z'")
}
$SellerAt = Get-UtcMinutesAgo 2
$BuyerAt = Get-UtcMinutesAgo 1
$CompletedAt = Get-UtcMinutesAgo 0

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

Write-Host "1. Readiness checks"
$services = @(
    @{ Name = "smart-meter"; Url = "$BASE_SMART_METER/health/ready" },
    @{ Name = "pricing"; Url = "$BASE_PRICING/health/ready" },
    @{ Name = "trade-matching"; Url = "$BASE_MATCHING/health/ready" },
    @{ Name = "billing-ledger"; Url = "$BASE_BILLING/health/ready" }
)

foreach ($svc in $services) {
    $response = Invoke-JsonApi -Url $svc.Url
    if ($response -and $response.status -eq "ready") {
        Add-Pass "$($svc.Name) ready"
    } else {
        Add-Fail "$($svc.Name) ready"
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
# A surplus of exactly what the buyer needs (4 kWh), so a run leaves no open
# offer behind to be matched with the next run's buyer.
$sellerReading = @{
    householdId = $SellerId
    productionKwh = 10
    consumptionKwh = 6
    timestamp = $SellerAt
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
    timestamp = $BuyerAt
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
    completedAt = $CompletedAt
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

Write-Host "10. Statistics"
# The analytics surface, read with the operator token: what the meters
# recorded, what traded, and whether the ledger still balances.
$energyStats = Invoke-JsonApi -Url "$BASE_SMART_METER/stats/summary" -Token $OperatorToken
if ($energyStats -and $energyStats.readings -ge 2 -and [decimal]$energyStats.productionKwh -gt 0) {
    Write-Host "Energy: readings=$($energyStats.readings) productionKwh=$($energyStats.productionKwh)"
    Add-Pass "energy statistics count the readings"
} else {
    Add-Fail "energy statistics count the readings"
}

$tradeStats = Invoke-JsonApi -Url "$BASE_MATCHING/stats/summary" -Token $OperatorToken
if ($tradeStats -and $tradeStats.trades.completed -ge 1 -and
    [decimal]$tradeStats.completed.volume -gt 0 -and
    $null -ne $tradeStats.completed.averagePricePerKwh) {
    Write-Host "Trades: completed=$($tradeStats.trades.completed) volume=$($tradeStats.completed.volume) avgPrice=$($tradeStats.completed.averagePricePerKwh)"
    Add-Pass "trade statistics report the settled trade"
} else {
    Add-Fail "trade statistics report the settled trade"
}

$billingStats = Invoke-JsonApi -Url "$BASE_BILLING/stats/summary" -Token $OperatorToken
if ($billingStats -and $billingStats.ledger.entries -ge 2 -and $billingStats.ledger.net -eq "0.00") {
    Write-Host "Ledger: entries=$($billingStats.ledger.entries) credited=$($billingStats.ledger.credited) net=$($billingStats.ledger.net)"
    Add-Pass "billing statistics show a ledger that balances"
} else {
    Add-Fail "billing statistics show a ledger that balances"
}

$trend = Invoke-JsonApi -Url "$BASE_MATCHING/stats/trends?bucket=hour" -Token $OperatorToken
$starts = @($trend.buckets | ForEach-Object { $_.bucketStart })
if ($trend -and $trend.bucket -eq "hour" -and $starts.Count -eq 24 -and
    (@(Compare-Object $starts ($starts | Sort-Object) -SyncWindow 0).Count -eq 0)) {
    Add-Pass "an hourly trend returns one bucket an hour, quiet ones included"
} else {
    Add-Fail "an hourly trend returns one bucket an hour, quiet ones included"
}

Assert-Status "statistics without a token are refused" 401 (Get-StatusCode -Method GET -Url "$BASE_MATCHING/stats/summary")
Assert-Status "statistics with the service token are forbidden" 403 (Get-StatusCode -Method GET -Url "$BASE_MATCHING/stats/summary" -Token $InternalToken)
Write-Host ""

Write-Host "Summary: $PassCount passed, $FailCount failed"
if ($FailCount -gt 0) {
    exit 1
}
exit 0
