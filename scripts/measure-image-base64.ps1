param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [int]$MaxWidth = 2048,
    [int]$MaxHeight = 768,

    [int]$PreferJpegAboveBytes = (600 * 1024),
    [int]$JpegQuality = 88
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $Path)) {
    throw "File not found: $Path"
}

$bytes = [System.IO.File]::ReadAllBytes($Path)
$origB64 = [Convert]::ToBase64String($bytes)
$origPrefix = "data:image/png;base64,"
$origDataUrlLen = $origPrefix.Length + $origB64.Length

Add-Type -AssemblyName System.Drawing
try {
    Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop | Out-Null
} catch {
    # Optional on some Windows setups.
}

$img = [System.Drawing.Image]::FromFile($Path)
try {
    $w = $img.Width
    $h = $img.Height

    $scale = [Math]::Min([Math]::Min($MaxWidth / $w, $MaxHeight / $h), 1.0)
    $newW = [Math]::Max(1, [int][Math]::Round($w * $scale))
    $newH = [Math]::Max(1, [int][Math]::Round($h * $scale))

    $bmp = New-Object System.Drawing.Bitmap $newW, $newH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighSpeed
            $g.DrawImage($img, 0, 0, $newW, $newH)
        } finally {
            $g.Dispose()
        }

        # Detect alpha by sampling up to 64x64 pixels.
        $sampleW = [Math]::Min(64, $bmp.Width)
        $sampleH = [Math]::Min(64, $bmp.Height)
        $hasAlpha = $false
        if ($bmp.PixelFormat.ToString() -match "Alpha|PArgb|Argb") {
            for ($y = 0; ($y -lt $sampleH) -and (-not $hasAlpha); $y++) {
                for ($x = 0; $x -lt $sampleW; $x++) {
                    $sx = [int]($x * ($bmp.Width - 1) / [Math]::Max(1, $sampleW - 1))
                    $sy = [int]($y * ($bmp.Height - 1) / [Math]::Max(1, $sampleH - 1))
                    $c = $bmp.GetPixel($sx, $sy)
                    if ($c.A -lt 255) {
                        $hasAlpha = $true
                        break
                    }
                }
            }
        }

        # Match the UI rule we added:
        # - If PNG has alpha => keep PNG
        # - If PNG is opaque and >= PreferJpegAboveBytes => JPEG
        $outMime = "image/png"
        if (-not $hasAlpha -and $bytes.Length -ge $PreferJpegAboveBytes) {
            $outMime = "image/jpeg"
        }

        $ms = New-Object System.IO.MemoryStream
        try {
            if ($outMime -eq "image/jpeg") {
                $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
                    Where-Object { $_.MimeType -eq "image/jpeg" } |
                    Select-Object -First 1

                $encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
                $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter (
                    [System.Drawing.Imaging.Encoder]::Quality,
                    ([long]$JpegQuality)
                )

                $bmpRgb = New-Object System.Drawing.Bitmap $bmp.Width, $bmp.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
                try {
                    $g2 = [System.Drawing.Graphics]::FromImage($bmpRgb)
                    try {
                        $g2.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height)
                    } finally {
                        $g2.Dispose()
                    }
                    $bmpRgb.Save($ms, $codec, $encParams)
                } finally {
                    $bmpRgb.Dispose()
                }
            } else {
                $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            }

            $outBytes = $ms.ToArray()
        } finally {
            $ms.Dispose()
        }
    } finally {
        $bmp.Dispose()
    }
} finally {
    $img.Dispose()
}

$outB64 = [Convert]::ToBase64String($outBytes)
$outPrefix = if ($outMime -eq "image/jpeg") { "data:image/jpeg;base64," } else { "data:image/png;base64," }
$outDataUrlLen = $outPrefix.Length + $outB64.Length

[PSCustomObject]@{
    original_bytes = $bytes.Length
    original_base64_len = $origB64.Length
    original_data_url_len = $origDataUrlLen
    original_dimensions = "${w}x${h}"
    compressed_mime = $outMime
    compressed_dimensions = "${newW}x${newH}"
    compressed_has_alpha = $hasAlpha
    compressed_bytes = $outBytes.Length
    compressed_base64_len = $outB64.Length
    compressed_data_url_len = $outDataUrlLen
} | ConvertTo-Json -Depth 3
