# Gera icon.png 117x117 exigido pelo Tizen
$root = $PSScriptRoot
$iconPath = Join-Path $root "icon.png"

Add-Type -AssemblyName System.Drawing

$size = 117
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$bg = [System.Drawing.Color]::FromArgb(255, 10, 10, 15)
$accent = [System.Drawing.Color]::FromArgb(255, 124, 92, 255)
$white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)

$g.Clear($bg)

$brush = New-Object System.Drawing.SolidBrush $accent
$g.FillEllipse($brush, 10, 10, $size - 20, $size - 20)

$play = @(
  [System.Drawing.Point]::new(42, 34),
  [System.Drawing.Point]::new(42, 83),
  [System.Drawing.Point]::new(84, 58)
)
$g.FillPolygon((New-Object System.Drawing.SolidBrush $white), $play)

$bmp.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
$brush.Dispose()

Write-Host "Ícone salvo em $iconPath" -ForegroundColor Green